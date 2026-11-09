// STEPWELL-01: THE TOWN STEPWELL (OWNER 2026-11-05: "Yes" to the control session's recommendation -- a showcase landmark that is the
// miners' safe shared descent; ledger stepwell-1105; design docs/reports/stepwell-design-2026-11-05.md, Claude + Codex reconciled).
// PURE: the switch, the shape (a square stepped tank cut into the ground), its cells and roles, the walk-safety proof, the siting
// survey, the record, what a unit of work needs next. Nothing here touches a bot or a file; skills.mjs buildStepwell runs the visit
// (stepwellvisit.mjs) on a real bot and publishes the record (buildproj.mjs).
//
// THE SHAPE (local frame u, v in 0..W-1, +v AWAY from home, shaftgeom.mjs toWorld; r = a column's ring index from the outer edge):
//   BANDS     every SW.band (3) rings is one band: band b = floor(r / 3), capped at the tank's tiers T. Band 0 is the RIM at ground g;
//             band t (1..T-1) is a terrace 4 (SW.tierD) below the band outside it; band T is the bottom COURT. A band's two outer rings
//             are its WALKWAY (2 wide), its inner ring the RAIL ring: a cobblestone wall post on every rail column (1.5 high: the
//             pathfinder never jumps one), so no walkway ever meets a drop of more than 1 (walkCheck proves it for every plan).
//   FLIGHTS   flight t (1..T) joins band t-1 to band t: on side (t-1) mod 4 (side 0 faces home), in band t, centred on the side: a HEAD
//             (raised to band t-1's level, posted), two TOP treads at +3, then +2, +1, then band t's floor; its inner ring raised to
//             the tread heights and posted (the flight's balustrade). Band t-1's rail ring has a 2-wide GAP over the top treads.
//   COURT     band T's floor (W - 6T wide); its centre 3x3 is a BASIN one block lower (the pool: dry until water is poured, bucketfix-01).
//   STONE     floors and the rail ring's top course are BUILT stone (the palette: stone bricks or cobblestone, seeded); wall faces keep
//             natural stone and replace dirt, gravel, sand, clay and ore with the palette's wall block; posts are cobblestone walls;
//             a torch stands on every SW.torchEvery-th post, on the heads and on the rail corners.
//   PHASES    this module builds the TANK (piece 1: tiers 1..SW.tiers); a later generation deepens it (SW.tiersMax) and the descent
//             below the court (phase 1b/2, the design's sections 3-4) is its own plan.
//
// THE ORDER IS THE SAFETY (stepwellNext): top down by LAYER. A layer's unit is: survey (every cell to open and its six neighbours:
// lava anywhere stops the tank above it; water is SEALED by a placement first; an unread cell waits), the cuts at that height, the
// faces they expose (bad blocks replaced), the floors that are tops at that height (and the cell under each), then the posts on them
// and the lights. Band t-1's posts therefore stand before tier t is cut a second layer deep: the drop beside a walkway is never more
// than 1 while it is being dug, and the flight (never cut) is the way in and out at every stage.

import { toWorld, awayFrom, isWet, isLava, isFalling, isOpen, isFull, goodSolid, replaceable, groundTop } from './shaftgeom.mjs'

export const STEPWELL_PLOT = 'stepwell'
export const STEPWELL_BLUEPRINT = 'stepwell@1'
export const STEPWELL_BUILDERS = 1
/**
 * STEPWELL-05: THE TANK'S CREW (LIVE showcase 11-06: felling 23 of 50 logs, then 3,653 cut cells and 2,168 build cells, all serial at
 * builders_max 1). A setting: STEPWELL_CREW (1..STEPWELL_CREW_MAX, default 2; 1 / off = exactly as before). The FELLING stays one
 * builder: the record's builders_max is raised (stepwellCrewDue, a published generation) only by a visit that reads every listed log
 * down, and the admission reads it (stepwellBuildersNow). In the tank a layer is SHARED BY SECTOR (crewSector: the tank's columns
 * split by angle round its centre, one sector a slot): each builder works its own sector of the first undone layer; with its part
 * done it takes the rest only when no other builder holds a slot, else its visit ends `shared` -- the layer order (the safety) is
 * never passed, and two builders never work one cell. The descent's stations are the lowest live slot's only. Pure.
 */
export const STEPWELL_CREW_MAX = 3
export function stepwellCrew (env = process.env) {
  const raw = String(env?.STEPWELL_CREW ?? '').trim().toLowerCase()
  if (raw === '') return 2
  if (['off', 'no', 'false'].includes(raw)) return 1
  const n = Number(raw)
  return Number.isInteger(n) && n >= 1 ? Math.min(n, STEPWELL_CREW_MAX) : 2
}
/** The builders the admission takes now -> 1..crew: the record's builders_max (raised after the felling), never above the setting. */
export function stepwellBuildersNow (rec, crew = stepwellCrew()) {
  const m = Number(rec?.builders_max)
  if (!(crew > 1) || !Number.isInteger(m) || m <= 1) return STEPWELL_BUILDERS
  return Math.min(m, crew)
}
/** The builders_max a visit publishes now -> n | null: only when every listed log reads down (`pending` 0: fellPending), the setting
 *  wants more than the record holds, and the tank is not stopped. Pure. */
export function stepwellCrewDue (rec, pending, crew = stepwellCrew()) {
  if (!rec || rec.state === 'stopped' || pending !== 0 || !(crew > 1)) return null
  const m = Number.isInteger(rec.builders_max) ? rec.builders_max : STEPWELL_BUILDERS
  return m < crew ? crew : null
}
/** A column's sector of `n` round the tank's centre [cx, cz] (plan.box's middle) -> 0..n-1 (by angle; n 1 -> 0). Pure. */
export function crewSector (centre, cell, n) {
  if (!(n > 1) || !Array.isArray(centre) || !Array.isArray(cell)) return 0
  const a = Math.atan2(cell[2] - centre[1], cell[0] - centre[0])
  return Math.min(n - 1, Math.floor(((a + Math.PI) / (2 * Math.PI)) * n))
}
/** A unit's cells that `keep(cell)` passes (the same y, tier and station). Pure. */
export function shareView (u, keep) {
  const f = l => (l ?? []).filter(c => keep(c))
  return { ...u, cut: f(u.cut), faces: f(u.faces), tops: f(u.tops), under: f(u.under), posts: f(u.posts), lights: f(u.lights) }
}
/**
 * THE BOUNDS. W: the top's width (odd); band: rings a band; tierD: a tier's depth; tiers: the tiers piece 1 builds; tiersMax: the
 * tiers the siting surveys for (the reservation's depth: a later generation deepens to it); ringMin/ringMax: the centre's Chebyshev
 * distance from home; step: the candidate grid; gap: the clearance off every reservation; groundUp/groundDown: the footprint's ground
 * above / below the rim level g (cut / filled); treeH: how far above the ground a log or leaf refuses a site; torchEvery: a light every
 * N posts along a side; unitOps / standTries: a visit's bounds; reach: a click's or a dig's reach from the eye; standReach: the reach a
 * STAND is chosen for (the eye to the cell's centre): short of `reach` by the half block a click's face lies below a post's centre
 * (Paper sandbox3 11-05: 48 posts refused no_reach from stands chosen at 4.5).
 */
export const SW = Object.freeze({ v: 1, W: 23, band: 3, tierD: 4, tiers: 2, tiersMax: 2, ringMin: 30, ringMax: 78, step: 2, gap: 2, groundUp: 9, groundDown: 2, innerDown: 3, treeH: 14, standMax: 5, torchEvery: 4, unitOps: 400, standTries: 3, reach: 4.5, standReach: 3.8 })
export const STEPWELL_ZONES = Object.freeze(['industry', 'monument', 'wild'])   // landplan.mjs zone kinds a stepwell may take: the miners' sector, the landmarks' sector, the wild (never town, homes, farms, the tree farm)

/** THE SWITCH -> bool. STEPWELL=on|off; unset = on only in STEPWELL_POOLS (default 'showcase'). Pure. */
export function stepwellOn (env = process.env, pool = '') {
  const v = String(env?.STEPWELL ?? '').trim().toLowerCase()
  if (['on', '1', 'true', 'yes'].includes(v)) return true
  if (['off', '0', 'false', 'no'].includes(v)) return false
  return String(env?.STEPWELL_POOLS ?? 'showcase').split(',').map(s => s.trim()).filter(Boolean).includes(String(pool ?? ''))
}
/** The licence row's detail (`_stepwell_mode`). Pure. */
export const stepwellModeDetail = on => `on=${on ? 1 : 0} W=${SW.W} tiers=${SW.tiers}/${SW.tiersMax} tierD=${SW.tierD} band=${SW.band}`

// ---- blocks -------------------------------------------------------------------------------------------------------------------

const nm = b => String(b?.name ?? '').replace(/\[.*\]$/, '')
const k3 = (x, y, z) => `${x},${y},${z}`
const kOf = a => `${a[0]},${a[1]},${a[2]}`
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]]
const N6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
/** BUILT STONE: what a floor or a trim cell must hold (any of these is done: a builder never re-lays another's stone). */
export const BUILT_STONE = /^(stone_bricks|mossy_stone_bricks|cracked_stone_bricks|chiseled_stone_bricks|cobblestone|mossy_cobblestone|smooth_stone|polished_(andesite|diorite|granite|deepslate|tuff|blackstone)|deepslate_(bricks|tiles)|cobbled_deepslate|tuff_bricks|bricks)$/
/** NATURAL STONE a wall face may keep (no ore: an ore in a face is dug for its drop and the face laid). */
export const NATURAL_STONE = /^(stone|deepslate|andesite|diorite|granite|tuff|calcite|blackstone|basalt|smooth_basalt|dripstone_block)$/
export const POST_BLOCK = /_wall$/
export const LIGHT_OK = /^(torch|lantern|soul_torch|soul_lantern)$/
/** The palette choices (seeded per town): floor, trim (the rail ring's top course and the heads), wall (the faces), post, light. */
export const PALETTES = Object.freeze([
  Object.freeze({ floor: ['stone_bricks', 'cobblestone'], trim: ['stone_bricks', 'cobblestone'], wall: ['cobblestone', 'stone_bricks'], post: ['cobblestone_wall'], light: ['torch'] }),
  Object.freeze({ floor: ['cobblestone', 'stone_bricks'], trim: ['stone_bricks', 'cobblestone'], wall: ['cobblestone', 'stone_bricks'], post: ['cobblestone_wall'], light: ['torch'] }),
  Object.freeze({ floor: ['stone_bricks', 'cobblestone'], trim: ['cobblestone', 'stone_bricks'], wall: ['stone_bricks', 'cobblestone'], post: ['cobblestone_wall'], light: ['torch'] }),
])
/** Is `b` good for a cell of `role`? -> true | false | null (unknown). Pure. `below` the read under it (a falling block's support). */
export function cellGood (role, b, below = null) {
  if (!b) return null
  const n = nm(b)
  switch (role) {
    case 'floor': case 'trim': return BUILT_STONE.test(n)
    case 'wall': return BUILT_STONE.test(n) || NATURAL_STONE.test(n)
    case 'body': case 'under': return goodSolid(b, below, false)
    case 'tread': return goodSolid(b, below, false) && !isFalling(b)
    case 'post': return POST_BLOCK.test(n)
    case 'light': case 'dlight': return LIGHT_OK.test(n)
    case 'cut': case 'stand': return isOpen(b) || (replaceable(b) && !isWet(b))
  }
  return false
}

// ---- the seed -----------------------------------------------------------------------------------------------------------------
function fnv (str) { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 } return h >>> 0 }
/** THE TOWN'S STEPWELL SEED (pool + home). Pure. */
export const stepwellSeed = (pool, home) => fnv(`stepwell@1|${pool ?? ''}|${home?.x},${home?.y},${home?.z}`)
/** The palette a seed picks. Pure. */
export const paletteFor = seed => PALETTES[(seed >>> 0) % PALETTES.length]

// ---- the shape (the column map) -----------------------------------------------------------------------------------------------

/** Side-local (a along the side, r inward) -> (u, v), side 0 facing home, clockwise. Pure. */
export function sideUV (W, side, a, r) {
  switch (((side % 4) + 4) % 4) {
    case 0: return [a, r]
    case 1: return [W - 1 - r, a]
    case 2: return [W - 1 - a, W - 1 - r]
    default: return [r, W - 1 - a]
  }
}
/** THE RIM's width: its outer PARAPET ring (a post on every column but the gate), its 2-wide walkway, its inner rail ring (Codex r1
 *  BLOCKER 3: the rim's outside is natural ground, often 2+ below it on the showcase's hills -- 206 of 8,184 candidates -- so the rim
 *  is walled outside too, with one 2-wide GATE facing home; Codex's design had the outer walls). */
export const RIM = SW.band + 1
/** The tiers W can hold: the court's flight (its three rings) stays outside the centre basin (r < c - 1). Pure. */
export const tiersFit = W => Math.max(0, Math.floor(((W - 1) / 2 - 4 - RIM) / SW.band) + 1)
/** The first ring of band t >= 1. Pure. */
export const bandR = t => RIM + SW.band * (t - 1)

/**
 * THE COLUMN MAP for a tank of width W, T tiers, rim at g -> Map('u,v' -> { u, v, r, b, s, kind, post, path, light, t }). Pure.
 *   s       the column's top solid (its walking surface; a post stands at s + 1)
 *   kind    'walk' | 'rail' | 'court' | 'basin' | 'gap' | 'head' | 'tread' | 'frail'
 *   post    a wall post at s + 1 (rail, head, frail); path: a walkable column (no post)
 *   t       the tier whose cut reaches the column's top (0 the rim, T the court); for a raised flight column, its band's tier
 */
export function columnMap ({ W = SW.W, T = SW.tiers, g }) {
  if (!(W % 2 === 1) || W < 7) throw new Error(`bad stepwell width ${W}`)
  if (T < 1 || T > tiersFit(W)) throw new Error(`a ${W}-wide tank holds 1..${tiersFit(W)} tiers, not ${T}`)
  const B = SW.band, D = SW.tierD, c = (W - 1) / 2
  const sOf = b => g - D * b
  const m = new Map()
  for (let u = 0; u < W; u++) for (let v = 0; v < W; v++) {
    const r = Math.min(u, v, W - 1 - u, W - 1 - v)
    const b = r < RIM ? 0 : Math.min(1 + Math.floor((r - RIM) / B), T)
    let kind = b === 0 ? (r === 0 ? 'parapet' : r === RIM - 1 ? 'rail' : 'walk') : b < T ? ((r - RIM) % B === B - 1 ? 'rail' : 'walk') : 'court'
    let s = sOf(b)
    if (b === T && Math.abs(u - c) <= 1 && Math.abs(v - c) <= 1) { kind = 'basin'; s -= 1 }
    m.set(`${u},${v}`, { u, v, r, b, s, kind, t: b })
  }
  // FLIGHTS: flight t in band t on side (t-1) mod 4, along a = c-2 (head) .. c+2 (the +1 tread)
  for (let t = 1; t <= T; t++) {
    const side = (t - 1) % 4
    const st = sOf(t)
    const rise = [D, D - 1, D - 1, D - 2, D - 3]   // head, top, top, +2, +1
    for (let i = 0; i < 5; i++) {
      const a = c - 2 + i
      for (let r = bandR(t); r <= bandR(t) + B - 1; r++) {
        const [u, v] = sideUV(W, side, a, r)
        const col = m.get(`${u},${v}`)
        col.s = st + rise[i]
        col.kind = i === 0 ? 'head' : (r === bandR(t) + B - 1 ? 'frail' : 'tread')
        col.t = t
      }
    }
    // band t-1's rail ring opens over the two top treads
    for (const a of [c - 1, c]) {
      const [u, v] = sideUV(W, side, a, bandR(t) - 1)
      const col = m.get(`${u},${v}`)
      col.kind = 'gap'
    }
  }
  // THE GATE: the parapet opens 2 wide in the middle of side 0 (toward home), in front of the exit
  for (const a of [c - 1, c]) { const [u, v] = sideUV(W, 0, a, 0); m.get(`${u},${v}`).kind = 'gate' }
  for (const col of m.values()) {
    col.post = col.kind === 'rail' || col.kind === 'head' || col.kind === 'frail' || col.kind === 'parapet'
    col.path = !col.post
  }
  // LIGHTS: the heads' middle columns, the rail rings' inner corners, every torchEvery-th rail post along a side from its middle
  for (const col of m.values()) {
    if (!col.post) continue
    const { u, v, r } = col
    const corner = (u === r || u === W - 1 - r) && (v === r || v === W - 1 - r)
    const along = (u === r || u === W - 1 - r) ? v : u
    if (col.kind === 'head') col.light = r === bandR(col.t) + 1
    else if (col.kind === 'rail' || col.kind === 'parapet') col.light = corner || (Math.abs(along - c) % SW.torchEvery === 0 && along !== c)
    else col.light = false
  }
  return m
}

/**
 * THE WALK PROOF -> { ok, problems: [why], reached, walkable }. Pure over the column map: every walkable column's four neighbours are
 * walkable within 1 up or down, or higher (a wall), or posted (a railing); and every walkable column is reached from the rim within
 * steps of 1 (no pocket a bot can stand in and not walk out of). The outer edge's neighbours (natural ground) are not judged.
 */
export function walkCheck (m, W) {
  const problems = []
  const get = (u, v) => m.get(`${u},${v}`)
  for (const col of m.values()) {
    if (!col.path) continue
    for (const [du, dv] of N4) {
      const n = get(col.u + du, col.v + dv)
      if (!n) continue
      if (n.post) { if (n.s < col.s) problems.push(`post below ${col.u},${col.v}`); continue }
      if (n.s < col.s - 1) problems.push(`drop ${col.s - n.s} at ${col.u},${col.v} -> ${n.u},${n.v}`)
    }
  }
  const start = [...m.values()].filter(c => c.path && c.r === 0)
  const seen = new Set(start.map(c => `${c.u},${c.v}`))
  const q = [...start]
  while (q.length) {
    const col = q.shift()
    for (const [du, dv] of N4) {
      const n = get(col.u + du, col.v + dv)
      if (!n || !n.path || seen.has(`${n.u},${n.v}`) || Math.abs(n.s - col.s) > 1) continue
      seen.add(`${n.u},${n.v}`); q.push(n)
    }
  }
  const walkable = [...m.values()].filter(c => c.path).length
  if (seen.size !== walkable) problems.push(`unreached ${walkable - seen.size}`)
  return { ok: problems.length === 0, problems, reached: seen.size, walkable }
}

// ---- the plan (world cells and units) -------------------------------------------------------------------------------------------

// ---- the descent (stepwell-02: the court's portal and the enclosed 2-wide switchback to y 16; Codex's module) ------------------------

/**
 * THE DESCENT'S BOUNDS. side: the tank side it runs under (2: the side away from the gate; the flights of a two-tier tank are on sides
 * 0 and 1); bottom: the lowest feet (the iron band); module: the drop of one switchback (two flights of 8 and two landings); landing:
 * a landing's length along the side. The module (Codex's design, local x along the side from the portal's landing, z across it from
 * the court side): flight A x 0..7 z 0..1 feet H-1-x; far landing x 8..10 z 0..4 feet H-8; flight B x 7..0 z 3..4 feet H-9..H-16; the
 * near landing x -3..-1 z 0..4 at the module's top H (the next module's top is H-16); z 2 a solid partition; three air cells over every
 * tread, two over a landing; every other face of an air cell lined. The PORTAL: the court wall (band T-1's rail ring) opened 2 wide
 * and 2 high beside the top landing, at the court's feet height. A last flight cut short at `bottom` ends on a 3-long landing.
 */
export const DESCENT = Object.freeze({ side: 2, bottom: 16, module: 16, flight: 8, landing: 3 })
/** THE DESCENT SWITCH -> bool. STEPWELL_DESCENT=on|off; unset = on wherever the stepwell is. Pure. */
export function descentOn (env = process.env) {
  const v = String(env?.STEPWELL_DESCENT ?? '').trim().toLowerCase()
  return !(v === 'off' || v === '0' || v === 'false' || v === 'no')
}
/**
 * THE DESCENT'S CELLS for a tank -> { air, treads, lights, portal, path, bottomFeet } in LOCAL (a, y, r) terms mapped by `at(u, y, v)`.
 * Pure. `site` = the tank's site (W, T, g) + `descent` = { bottom } (a survey's truncation: the lowest feet it reaches). `path`: the stands
 * in walking order from the portal down (one lane), for the egress and the walk proof.
 */
export function descentCells (site, at) {
  const W = site.W ?? SW.W, T = site.T ?? SW.tiers, g = site.g
  const bottom = Math.max(site.descent?.bottom ?? DESCENT.bottom, -60)
  const side = DESCENT.side
  const c = (W - 1) / 2
  const xa0 = c - 1                        // the first step's along coordinate (the top landing at xa0-3 .. xa0-1)
  const rTop = bandR(T) - 2                // z 0 (the court side) -> r = rTop - z; the court wall (the portal) at r = rTop + 1
  const H0 = g - SW.tierD * T + 1          // the court's feet
  const P = (x, y, z) => { const [u, v] = sideUV(W, side, xa0 + x, rTop - z); return at(u, y, v) }
  const air = [], treads = [], lights = [], path = []
  const room = (x, z, feet, n) => { for (let i = 0; i < n; i++) air.push(P(x, feet + i, z)); treads.push(P(x, feet - 1, z)) }
  const landing = (xs, feet, zs = [0, 1, 2, 3, 4]) => { for (const x of xs) for (const z of zs) room(x, z, feet, 2) }
  // the portal: the court wall opened beside the top landing (x -2, -1), feet and head, on the court's floor level
  const portal = []
  for (const x of [-2, -1]) for (const y of [H0, H0 + 1]) { const [u, v] = sideUV(W, side, xa0 + x, rTop + 1); portal.push(at(u, y, v)) }
  for (const x of [-2, -1]) { const [u, v] = sideUV(W, side, xa0 + x, rTop + 1); treads.push(at(u, H0 - 1, v)); path.push(at(u, H0, v)) }
  // the court's stands in front of the portal (the way in: they must stay the tank's open cuts -- both engines' r1 BLOCKER)
  const court = [-2, -1].map(x => { const [u, v] = sideUV(W, side, xa0 + x, rTop + 2); return at(u, H0, v) })
  let H = H0, bottomFeet = H0
  landing([-3, -2, -1], H)
  path.push(P(-1, H, 0))
  for (;;) {
    // flight A (x 0..7) down from H
    let done = false
    for (let x = 0; x < DESCENT.flight; x++) {
      const feet = H - 1 - x
      for (const z of [0, 1]) room(x, z, feet, 3)
      path.push(P(x, feet, 0))
      bottomFeet = feet
      // the terminal landing stays in the flight's own lane (z 0-1): across it, the module above's flight B runs low here
      if (feet <= bottom) { landing([x + 1, x + 2, x + 3], feet, [0, 1]); path.push(P(x + 3, feet, 0)); lights.push(P(x + 3, feet, 1)); done = true; break }
    }
    if (done) break
    landing([8, 9, 10], H - 8)
    path.push(P(9, H - 8, 2)); lights.push(P(10, H - 8, 2))
    for (let i = 0; i < DESCENT.flight; i++) {
      const x = 7 - i, feet = H - 9 - i
      for (const z of [3, 4]) room(x, z, feet, 3)
      path.push(P(x, feet, 4))
      bottomFeet = feet
      if (feet <= bottom) { landing([x - 1, x - 2, x - 3], feet, [3, 4]); path.push(P(x - 3, feet, 4)); lights.push(P(x - 3, feet, 3)); done = true; break }
    }
    if (done) break
    H -= DESCENT.module
    landing([-3, -2, -1], H)
    path.push(P(-2, H, 2)); lights.push(P(-3, H, 2))
  }
  // a landing's torch cell (its far end, off the path) is the torch's, never a cut: left standing when the bag has no torch
  const lk = new Set(lights.map(kOf))
  return { air: air.filter(a => !lk.has(kOf(a))), treads, lights, portal, path, bottomFeet, court }
}

/**
 * THE DESCENT'S SURVEY -> { ok, bottom, why, hazard, counts }. Pure over read. The descent for `site` down to DESCENT.bottom; a lava cell
 * in or beside its air, or water IN its air, ends it above: the bottom rises to 3 above the highest such cell and the descent is
 * planned again (water beside the air is sealed by the build: a record cell). `ok` false when no flight is left above the hazard or a
 * cell is unread (`unknown`: ask again later). counts: cave (air in its lining), water (beside), ore (in its air: the builder's loot).
 */
export function surveyDescent (read, site, { keep = null } = {}) {
  const H0 = site.g - SW.tierD * (site.T ?? SW.tiers) + 1
  let bottom = DESCENT.bottom
  for (let round = 0; round < 8; round++) {
    if (bottom > H0 - 2) return { ok: false, why: 'no_room', bottom }
    const P = planTank({ ...site, descent: { bottom } })
    const D = P.descent
    const airK = new Set([...D.air, ...D.portal].map(kOf))
    const counts = { cave: 0, water: 0, ore: 0, cells: airK.size }
    let hazard = null
    if (keep) for (const a of descentAllCells(P)) if (keep(...a) || N6.some(([dx, dy, dz]) => keep(a[0] + dx, a[1] + dy, a[2] + dz))) hazard = Math.max(hazard ?? -999, a[1])
    for (const a of [...D.air, ...D.portal]) {
      // townmine-01 (OWNER 11-09 'a mine is working way down is fine'): the town mine is the showcase's way down; the stepwell's
      // descent stops ABOVE every mine cell -- a descent cell on or beside one is a hazard like lava (the bottom rises over it)
      if (keep && (keep(...a) || N6.some(([dx, dy, dz]) => keep(a[0] + dx, a[1] + dy, a[2] + dz)))) { hazard = Math.max(hazard ?? -999, a[1]); continue }
      const b = read(...a)
      if (!b) return { ok: false, why: 'unknown', bottom }
      if (isLava(b) || isWet(b)) { hazard = Math.max(hazard ?? -999, a[1]); continue }
      if (ORE.test(nm(b))) counts.ore++
      for (const [dx, dy, dz] of N6) {
        const n = [a[0] + dx, a[1] + dy, a[2] + dz]
        if (airK.has(kOf(n))) continue
        const nb = read(...n)
        if (!nb) return { ok: false, why: 'unknown', bottom }
        if (isLava(nb)) { hazard = Math.max(hazard ?? -999, a[1]); continue }
        if (isWet(nb)) counts.water++
        else if (isOpen(nb) && n[1] < site.g - SW.tierD * (site.T ?? SW.tiers)) counts.cave++
      }
    }
    if (hazard == null) return { ok: true, bottom, why: null, counts, bottomFeet: D.bottomFeet }
    bottom = hazard + 3
  }
  return { ok: false, why: 'hazards', bottom }
}
/** DOES A PLANNED DESCENT TOUCH THE TOWN MINE? -> the highest feet y of a descent cell on or beside a mine cell | null. Pure. */
export function descentMineHit (site, keep) {
  if (!site?.descent || !keep) return null
  let hit = null
  // EVERY descent cell (Codex r4 BLOCKER 2): its air, portal, treads and lights, and every structural cell the plan marks as the
  // descent's (its lining walls) -- on a mine cell or beside one
  for (const a of descentAllCells(planTank(site))) if (keep(...a) || N6.some(([dx, dy, dz]) => keep(a[0] + dx, a[1] + dy, a[2] + dz))) hit = Math.max(hit ?? -999, a[1])
  return hit
}
/** Every cell of a plan's descent: its air, portal, treads, lights and the plan's descent-marked cells. Pure. */
export function descentAllCells (P) {
  const D = P?.descent
  if (!D) return []
  return [...D.air, ...D.portal, ...D.treads, ...D.lights, ...(P.cells ?? []).filter(e => e.d).map(e => e.at)]
}
/**
 * THE STEPWELL CLEAR OF THE TOWN MINE (townmine-01, OWNER 11-09 option A) -> the next generation | null (already clear). Pure. A sited
 * descent that touches a mine cell is planned again with its bottom raised over the highest touching cell (3 above, as a hazard);
 * if no flight is left above it the descent is dropped (descentNone why=mine). The tank is never touched.
 */
export function stepwellClearOfMine (rec, keep, { now = Date.now() } = {}) {
  if (!rec?.site?.descent || !keep) return null
  let bottom = rec.site.descent.bottom ?? DESCENT.bottom
  const H0 = rec.site.g - SW.tierD * (rec.site.T ?? SW.tiers) + 1
  for (let round = 0; round < 12; round++) {
    const hit = descentMineHit({ ...rec.site, descent: { bottom } }, keep)
    if (hit == null) break
    bottom = hit + 3
  }
  if (bottom === (rec.site.descent.bottom ?? DESCENT.bottom)) return null
  const bare = { ...rec, site: { ...rec.site } }
  delete bare.site.descent
  if (bottom > H0 - 2) {
    // the TANK's own cuts kept as listed (the same cut-top rule as the record's), the felling carried (Codex r4 BLOCKER 1: the clear
    // list is rebuilt from the tank-only plan's cuts, never filtered against its structural cells)
    const oldD = new Set(descentAllCells(planTank(rec.site)).map(kOf))
    const listed = new Set((rec.clear ?? []).filter(c => c.kind === 'cut' && !oldD.has(kOf(c.at))).map(c => kOf(c.at)))
    const P = planTank(bare.site, { cutKeep: c => listed.has(kOf(c)) })
    const fell = (rec.clear ?? []).filter(c => c.kind === 'tree' || c.kind === 'leaves')
    return { ...bare, cells: P.cells.map(e => ({ at: e.at, role: e.role, t: e.t, ...(e.d ? { d: 1 } : {}), ...(e.role === 'stand' ? { seg: FELL_SEG } : {}) })),
      clear: [...fell.filter(c => !P.byKey.has(kOf(c.at))), ...P.cut.map(c => ({ at: c.at, kind: 'cut', t: c.t }))], descent: null, descentNone: { why: 'mine', bottom, at: now } }
  }
  const D = planTank({ ...rec.site, descent: { bottom } }).descent
  return stepwellWithDescent(bare, { ok: true, bottom, bottomFeet: D.bottomFeet, counts: { cells: D.air.length + D.portal.length, mine: 1 } }, { now })
}
/**
 * THE RECORD UPGRADED WITH ITS DESCENT (stepwell-02: a record sited by stepwell-01 had none) -> the next generation | null (nothing to
 * do). Pure. The tank's cells and cuts kept as they are (the same cut-top rule), the felling's clears, trees and replants carried; the
 * descent's cells and cuts added; the portal's wall cells become cuts; the record open again until the descent stands.
 */
export function stepwellWithDescent (rec, sd, { now = Date.now() } = {}) {
  if (!rec || rec.site?.descent || !sd?.ok || rec.state === 'stopped') return null
  const site = { ...rec.site, descent: { bottom: sd.bottom } }
  const listed = new Set((rec.clear ?? []).filter(c => c.kind === 'cut').map(c => kOf(c.at)))
  const dk = new Set((() => { const P0 = planTank(site); return [...P0.descent.air, ...P0.descent.portal].map(kOf) })())
  const P = planTank(site, { cutKeep: c => listed.has(kOf(c)) || dk.has(kOf(c)) })
  const fell = (rec.clear ?? []).filter(c => c.kind === 'tree' || c.kind === 'leaves')
  const clear = [...fell.filter(c => !P.byKey.has(kOf(c.at))), ...P.cut.map(c => ({ at: c.at, kind: 'cut', t: c.t, ...(c.d ? { d: 1 } : {}) }))]
  return { ...rec, site, cells: P.cells.map(e => ({ at: e.at, role: e.role, t: e.t, ...(e.d ? { d: 1 } : {}), ...(e.role === 'stand' ? { seg: FELL_SEG } : {}) })), clear,
    descent: { bottom: sd.bottom, bottomFeet: sd.bottomFeet, at: now, cells: dk.size, survey: sd.counts }, structure_complete: false, state: 'open', descent_built: false }
}

/** The origin (local 0,0) of a W-wide tank centred on world (cx, cz) facing `away`. Pure. */
export function originFor (cx, cz, away, W = SW.W) {
  const c = (W - 1) / 2
  const p = toWorld({ x: 0, z: 0 }, away, c, c)
  return { x: cx - p.x, z: cz - p.z }
}

/**
 * THE TANK'S CELLS -> { site, W, T, g, cols, cells, byKey, cut, units, box, exit, minY }. Pure. `site` = { origin, away, g, W, T }.
 *   cells  [{ at, role, y, t }]: role 'floor' | 'trim' | 'wall' | 'body' | 'under' | 'post' | 'light' (placed or kept) -- the record's
 *          cells; cut: [{ at, t }] -- the record's clear list (every cell from a column's top + 1 to g + groundUp but its post/light)
 *   units  top down: [{ y, t, cut: [cells], tops: [cells], faces: [cells], under: [cells], posts: [cells], lights: [cells] }]
 *   exit   the rim stand outside side 0's middle (feet), where every visit starts and ends
 */
export function planTank (site, { cutKeep = null } = {}) {
  const W = site.W ?? SW.W, T = site.T ?? SW.tiers, g = site.g
  const cols = columnMap({ W, T, g })
  const at = (u, y, v) => { const w = toWorld(site.origin, site.away, u, v); return [w.x, y, w.z] }
  const top = g + SW.groundUp
  const cells = [], cut = []
  const byKey = new Map()
  const add = (c, role, t, d = false) => { const k = kOf(c); if (byKey.has(k)) return; const e = { at: c, role, t, y: c[1], ...(d ? { d: true } : {}) }; byKey.set(k, e); cells.push(e) }
  const get = (u, v) => cols.get(`${u},${v}`)
  for (const col of cols.values()) {
    // the top: built stone (floor on a walkway, trim under a post); its post and light
    add(at(col.u, col.s, col.v), col.post ? 'trim' : 'floor', col.t)
    if (col.post) add(at(col.u, col.s + 1, col.v), 'post', col.t)
    if (col.light) add(at(col.u, col.s + 2, col.v), 'light', col.t)
  }
  for (const col of cols.values()) {
    // FACES: the column's cells above a lower neighbour's top (and below its own): laid stone or natural stone
    let low = col.s
    for (const [du, dv] of N4) { const n = get(col.u + du, col.v + dv); if (n && n.s < low) low = n.s }
    for (let y = low + 1; y < col.s; y++) add(at(col.u, y, col.v), 'wall', col.t)
    // a raised flight column's hidden body (between its band's floor and its top) must be solid too
    if (col.kind === 'head' || col.kind === 'tread' || col.kind === 'frail') {
      const sb = g - SW.tierD * col.t
      for (let y = sb + 1; y < col.s; y++) add(at(col.u, y, col.v), 'body', col.t)
    }
    // UNDER: the cell under a top (a cave there would leave a floor over a void): any good solid
    add(at(col.u, col.s - 1, col.v), 'under', col.t)
  }
  // THE DESCENT (stepwell-02, site.descent): its portal opens the court wall (those wall cells become cuts), its air cells are cuts of
  // the tier after the tank's (T + 1), its treads `tread`, every other face of its air lined (`wall`: natural stone kept), its torches
  // `dlight` on the landings (a torch on the floor: optional, as the tank's)
  let D = null
  const dAir = new Set()
  if (site.descent) {
    D = descentCells({ ...site, W, T }, at)
    const td = T + 1
    const open = [...D.air, ...D.portal]
    for (const a of open) dAir.add(kOf(a))
    for (const k of dAir) { if (byKey.has(k)) { const e = byKey.get(k); byKey.delete(k); cells.splice(cells.indexOf(e), 1) } }
    for (const tc of D.treads) if (!dAir.has(kOf(tc))) add(tc, byKey.get(kOf(tc))?.role ?? 'tread', td, true)
    for (const l of D.lights) add(l, 'dlight', td, true)   // before the lining: a torch cell is never lined
    // the tank's columns by world (x, z): a neighbour above its column's top is one of the tank's own CUTS (the court in front of the
    // portal above all) -- never lined (Codex + Claude r1 BLOCKER: the lining walled the portal shut from the court)
    const colAt = new Map()
    for (const col of cols.values()) { const w = at(col.u, 0, col.v); colAt.set(`${w[0]},${w[2]}`, col) }
    for (const a of open) {
      for (const [dx, dy, dz] of N6) {
        const n = [a[0] + dx, a[1] + dy, a[2] + dz]
        if (dAir.has(kOf(n)) || n[1] > g) continue
        const col = colAt.get(`${n[0]},${n[2]}`)
        if (col && n[1] > col.s) continue
        add(n, 'wall', td, true)
      }
    }
  }
  for (const col of cols.values()) {
    for (let y = col.s + 1; y <= top; y++) {
      const c = at(col.u, y, col.v)
      if (byKey.has(kOf(c)) || dAir.has(kOf(c))) continue
      if (cutKeep && !cutKeep(c)) continue
      cut.push({ at: c, t: y > g ? 1 : tierOfY(g, y) })
    }
  }
  if (D) for (const a of [...D.air, ...D.portal]) { if (byKey.has(kOf(a)) || (cutKeep && !cutKeep(a))) continue; cut.push({ at: a, t: T + 1, d: true }) }
  // THE FELLING STANDS (site.stands, the siting's plotPrep staircases beside tall trunks): record cells while the trees stand, taken
  // back down by the tank's own cut of their layer (`stand` cells dig as `foreign`: they are record cells, never clears)
  for (const at of site.stands ?? []) {
    const k = kOf(at)
    if (byKey.has(k)) continue
    const i = cut.findIndex(c => kOf(c.at) === k)
    const t = i >= 0 ? cut[i].t : 1
    if (i >= 0) cut.splice(i, 1)
    add(at, 'stand', t)
  }
  const cutKeys = new Set(cut.map(c => kOf(c.at)))
  // UNITS, top down: each layer's cuts, then the faces at that height, the tops there (and the cell under each), posts, lights
  const minY = Math.min(...[...cols.values()].map(c => c.s), ...(D ? D.treads.map(q => q[1]) : []))
  const units = []
  const tankMin = Math.min(...[...cols.values()].map(c => c.s))
  for (let y = top; y >= tankMin; y--) {
    const u = { y, t: y > g ? 1 : tierOfY(g, y), cut: [], faces: [], tops: [], under: [], posts: [], lights: [] }
    for (const c of cut) if (c.at[1] === y && !c.d) u.cut.push(c.at)
    for (const e of cells) {
      if (e.d) continue   // the descent's cells are its own units (below)
      if (e.y === y && e.role === 'stand') u.cut.push(e.at)
      else if (e.y === y && (e.role === 'wall' || e.role === 'body')) u.faces.push(e.at)
      else if (e.y === y && (e.role === 'floor' || e.role === 'trim' || e.role === 'tread')) u.tops.push(e.at)
      else if (e.y === y + 1 && e.role === 'dlight') u.lights.push(e.at)
      else if (e.y === y - 1 && e.role === 'under') u.under.push(e.at)
      else if (e.y === y + 1 && e.role === 'post') u.posts.push(e.at)
      else if (e.y === y + 2 && e.role === 'light') u.lights.push(e.at)
    }
    if (u.cut.length || u.faces.length || u.tops.length || u.under.length || u.posts.length || u.lights.length) units.push(u)
  }
  // THE DESCENT'S UNITS (stepwell-02), after the tank's: one STATION per tread -- its air cells (top down), the lining beside them not
  // claimed by an earlier station, its tread, a torch on it -- in the order a bot reaches them from the court (breadth first over
  // stations side by side within one step up or down, from the portal's): each station is cut from the one before it, as the town
  // stair's steps are (a layer order cannot be: a tunnel's far end has no stand until its near end is open)
  if (D) {
    const airK = new Set([...D.air, ...D.portal].map(kOf))
    const lightAt = new Map(D.lights.map(l => [k3(l[0], l[1] - 1, l[2]), l]))
    const lightK = new Set(D.lights.map(kOf))
    const stations = D.treads.map(tc => {
      const a = []
      // the column's air over the tread (a landing's torch cell is passed over: the head cell above it is this station's)
      for (let y = tc[1] + 1; airK.has(k3(tc[0], y, tc[2])) || lightK.has(k3(tc[0], y, tc[2])); y++) if (airK.has(k3(tc[0], y, tc[2]))) a.push([tc[0], y, tc[2]])
      return { tread: tc, air: a, feet: tc[1] + 1, k: kOf(tc) }
    }).filter(q => q.air.length || lightAt.has(q.k))
    const portalK = new Set(D.portal.map(p => k3(p[0], p[1] - 1, p[2])))
    const seen = new Set(), order = []
    const q = stations.filter(st => portalK.has(st.k))
    for (const st of q) seen.add(st.k)
    while (q.length) {
      const st = q.shift(); order.push(st)
      for (const o of stations) {
        if (seen.has(o.k) || Math.abs(o.tread[0] - st.tread[0]) + Math.abs(o.tread[2] - st.tread[2]) !== 1 || Math.abs(o.feet - st.feet) > 1) continue
        seen.add(o.k); q.push(o)
      }
    }
    for (const st of stations) if (!seen.has(st.k)) order.push(st)   // unreachable (the proof refuses such a plan): last
    const claimed = new Set()
    for (const st of order) {
      const u = { y: st.feet, t: T + 1, station: st.k, cut: [...st.air].sort((a, b) => b[1] - a[1]), faces: [], tops: [], under: [], posts: [], lights: [] }
      for (const a of st.air) for (const [dx, dy, dz] of N6) {
        const n = [a[0] + dx, a[1] + dy, a[2] + dz], nk = kOf(n)
        if (claimed.has(nk) || airK.has(nk)) continue
        const e = byKey.get(nk)
        if (e && e.d && e.role === 'wall') { claimed.add(nk); u.faces.push(n) }
      }
      const te = byKey.get(st.k)
      if (te && te.d) { claimed.add(st.k); u.tops.push(st.tread) }
      if (lightAt.has(st.k)) u.lights.push(lightAt.get(st.k))
      units.push(u)
    }
    // any lining no station claimed (a corner reached only diagonally) goes with the last station
    const rest = cells.filter(e => e.d && e.role === 'wall' && !claimed.has(kOf(e.at)))
    if (rest.length && units.length) units.at(-1).faces.push(...rest.map(e => e.at))
  }
  // a stable sweep order inside a unit (nearest the flight first, then by row): never the order of a Map
  for (const u of units) for (const k of ['cut', 'faces', 'tops', 'under', 'posts', 'lights']) if (!u.station) u[k].sort((a, b) => a[0] - b[0] || a[2] - b[2] || b[1] - a[1])
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
  for (const col of cols.values()) { const c = at(col.u, 0, col.v); x0 = Math.min(x0, c[0]); x1 = Math.max(x1, c[0]); z0 = Math.min(z0, c[2]); z1 = Math.max(z1, c[2]) }
  const cc = (W - 1) / 2
  const exit = at(cc, Number.isInteger(site.exitY) ? site.exitY : g + 1, -1)   // Codex r2: the exit's feet on the surveyed gate-front floor
  return { site: { ...site, W, T }, W, T, g, cols, cells, byKey, cut, cutKeys, sealKeys: cutKeys, units, minY, top, box: [x0, z0, x1, z1], exit, descent: D }
}
/** The tier a cut at height y (at or below g) belongs to. Pure. */
export function tierOfY (g, y) { return Math.max(1, Math.ceil((g - y + 1) / SW.tierD)) }

// ---- what a unit needs next --------------------------------------------------------------------------------------------------

/** The roles a placement may fill in a cell: a sealed liquid in a CUT cell is placed too (its dig follows: the cut's own row). */
const PLACE_ROLE = { floor: 'floor', trim: 'trim', wall: 'wall', body: 'body', under: 'under', post: 'post', light: 'light', tread: 'tread', dlight: 'dlight' }
/** Is cell `c` done for its role? -> true | false | null. Pure over read. */
export function cellDone (read, plan, c) {
  const k = kOf(c)
  const e = plan.byKey.get(k)
  const b = read(...c)
  if (!b) return null
  if (!e) return plan.cutKeys.has(k) ? cellGood('cut', b) : null
  return cellGood(e.role, b, read(c[0], c[1] - 1, c[2]))
}
/** IS THE UNIT DONE? -> true | false | null. Pure. The LIGHTS never hold a unit (a town with no torch still gets its tank: a light is
 *  laid when the bag has one -- stepwellNext `lights` -- and a later visit lays the ones passed). */
export function unitDone (read, plan, u, { lights = false } = {}) {
  for (const c of [...u.cut, ...u.faces, ...u.under, ...u.tops, ...u.posts, ...(lights ? u.lights : [])]) {
    const d = cellDone(read, plan, c)
    if (d == null) return null
    if (!d) return false
  }
  return true
}
/** THE FIRST UNIT NOT DONE, top down -> { i, unit } | { i, unknown: true } | null (the tank stands). Repairs are the same scan. Pure. */
export function firstUndoneUnit (read, plan, { lights = false } = {}) {
  for (let i = 0; i < plan.units.length; i++) {
    const d = unitDone(read, plan, plan.units[i], { lights })
    if (d == null) return { i, unit: plan.units[i], unknown: true }
    if (!d) return { i, unit: plan.units[i] }
  }
  return null
}

/** The bot's body cells (feet, head) and its floor. Pure. */
const bodyOf = feet => feet ? [kOf(feet), k3(feet[0], feet[1] + 1, feet[2]), k3(feet[0], feet[1] - 1, feet[2])] : []
/**
 * THE NEXT MUTATION OF A UNIT -> { op: 'stop', why, at } | { op: 'wait', at } | { op: 'place', at, role, why } | { op: 'dig', at, why,
 * kind } | { op: 'done' }. Pure over read. THE ORDER IS THE SAFETY: (1) every cut cell of the unit and its six neighbours surveyed --
 * lava anywhere STOPS (the tank ends above this layer), a liquid neighbour is SEALED by a placement first (a record cell or a cut
 * cell: the cut's dig removes the seal block after), an unread cell waits; (2) the cuts (never the bot's own body or floor);
 * (3) the faces and bodies: a cell not good is dug (if solid: `foreign`) and placed; (4) the cells under the tops; (5) the tops;
 * (6) the posts; (7) the lights. `skip` keys the visit set aside (refused twice); `feet` the bot's feet cell.
 */
export function stepwellNext (read, plan, u, { feet = null, skip = new Set(), lights = true } = {}) {
  const body = new Set(bodyOf(feet))
  // A SEAL goes into a record cell or a CUT cell of kind cut (plan.sealKeys: the tripwire's SW1 -- never a felling clear, never off the
  // record); water anywhere else beside a cut stops the tank above it
  const sealable = k => plan.byKey.has(k) || (plan.sealKeys ?? plan.cutKeys).has(k)
  const sealOp = n => {
    const k = kOf(n)
    if (!sealable(k)) return { op: 'stop', why: 'water_outside', at: n }
    // a seal refused twice this visit (skipped) still BLOCKS every dig beside it: the visit ends unsealed (Codex r1 BLOCKER 1)
    if (skip.has(k)) return { op: 'stop', why: 'unsealed', at: n }
    // a WATERLOGGED block already good for its role (a wall post): a placement there would read confirmed and loop -- unsealed (Claude r2)
    const e0 = plan.byKey.get(k)
    if (e0 && cellGood(e0.role, read(...n), read(n[0], n[1] - 1, n[2])) === true) return { op: 'stop', why: 'unsealed', at: n }
    const op = { op: 'place', at: n, role: plan.byKey.get(k)?.role ?? 'seal', why: 'seal' }
    // the bot's own cell: placed from another stand (the visit moves), never skipped past (Codex r1 BLOCKER 1)
    return body.has(k) ? { ...op, own: true } : op
  }
  // 1. SURVEY
  for (const c of u.cut) {
    const b = read(...c)
    if (!b) return { op: 'wait', at: c }
    if (isLava(b)) return { op: 'stop', why: 'lava', at: c }
    if (cellGood('cut', b)) continue   // open already: a liquid beside an open cell would have flowed into it (then it reads wet)
    for (const [dx, dy, dz] of N6) {
      const n = [c[0] + dx, c[1] + dy, c[2] + dz]
      const nb = read(...n)
      if (!nb) return { op: 'wait', at: n }
      if (isLava(nb)) return { op: 'stop', why: 'lava', at: n }
      if (isWet(nb)) return sealOp(n)
    }
    if (isWet(b)) return sealOp(c)
  }
  // 2. THE CUTS (top down within the layer is one height; a falling block over a cut falls into it and is cut again)
  let own = null   // the first op on the bot's own body or floor: returned last, marked `own` (the visit moves to another stand for it)
  for (const c of u.cut) {
    if (skip.has(kOf(c))) continue
    const b = read(...c)
    if (cellGood('cut', b)) continue
    const op = { op: 'dig', at: c, why: 'cut', kind: plan.byKey.get(kOf(c))?.role === 'stand' ? 'foreign' : 'cut' }
    if (body.has(kOf(c))) { own ??= op; continue }
    return op
  }
  // 3-7. faces, unders, tops, posts, lights: a cell not good is made good
  for (const [list, why] of [[u.faces, 'face'], [u.under, 'under'], [u.tops, 'top'], [u.posts, 'post'], [lights ? u.lights : [], 'light']]) {
    for (const c of list) {
      const k = kOf(c)
      if (skip.has(k)) continue
      const e = plan.byKey.get(k)
      const b = read(...c)
      if (!b) return { op: 'wait', at: c }
      const below = read(c[0], c[1] - 1, c[2])
      if (cellGood(e.role, b, below)) continue
      if (body.has(k)) { own ??= { op: isOpen(b) || replaceable(b) || isWet(b) ? 'place' : 'dig', at: c, role: PLACE_ROLE[e.role], why, kind: 'foreign' }; continue }
      // a post or a light goes on what is under it: wait for that first (its own unit's top, or the post)
      if (e.role === 'post' && !cellGood('trim', below)) continue
      if (e.role === 'light' && !cellGood('post', below)) continue
      if (e.role === 'dlight' && !cellGood('tread', below)) continue
      if (isOpen(b) || replaceable(b) || isWet(b)) return { op: 'place', at: c, role: PLACE_ROLE[e.role], why }
      if (isLava(b)) return { op: 'stop', why: 'lava', at: c }
      // a solid that is not good: dug first (its drop is the bot's), then placed on the next pass -- surveyed like a cut
      for (const [dx, dy, dz] of N6) {
        const n = [c[0] + dx, c[1] + dy, c[2] + dz]
        const nb = read(...n)
        if (!nb) return { op: 'wait', at: n }
        if (isLava(nb)) return { op: 'stop', why: 'lava', at: n }
        if (isWet(nb)) {
          const so = sealOp(n)
          if (so.op === 'stop') { skip.add(k); break }   // never open a cell to a liquid it cannot seal: the face stays as it stands
          return so
        }
      }
      if (skip.has(k)) continue
      return { op: 'dig', at: c, why, kind: 'foreign' }
    }
  }
  if (own) return { ...own, own: true }
  return { op: 'done' }
}

/** Is a cell within reach of a stand's eye (feet + EYE, the cell's centre)? Pure. */
export function inReach (feet, c, reach = SW.reach) {
  const ex = feet[0] + 0.5, ey = feet[1] + 1.62, ez = feet[2] + 0.5
  return Math.hypot(c[0] + 0.5 - ex, c[1] + 0.5 - ey, c[2] + 0.5 - ez) <= reach
}
/**
 * THE STANDS FOR A CELL -> [[x, y, z] feet], best first. Pure over read. A stand is a column inside the tank's box + 2 whose top solid
 * (read now) carries open feet and head cells; the cell in reach of its eye; never the cell itself, its body or its floor. The bot's own
 * feet first, then the nearest to the bot. `banned` stands a walk failed to reach.
 */
export function standsFor (read, plan, c, { feet = null, banned = new Set(), max = 6 } = {}) {
  const out = []
  const [x0, z0, x1, z1] = plan.box
  const key = kOf(c)
  for (let x = Math.max(x0 - 2, c[0] - 4); x <= Math.min(x1 + 2, c[0] + 4); x++) {
    for (let z = Math.max(z0 - 2, c[2] - 4); z <= Math.min(z1 + 2, c[2] + 4); z++) {
      for (let y = Math.min(plan.top + 1, c[1] + 4); y >= Math.max(plan.minY, c[1] - 4); y--) {
        const fl = read(x, y - 1, z), f = read(x, y, z), h = read(x, y + 1, z)
        if (!fl || !f || !h) continue
        if (!(isFull(fl) && !isFalling(fl) && isOpen(f) && isOpen(h))) continue
        const s = [x, y, z]
        if ([kOf(s), k3(x, y + 1, z), k3(x, y - 1, z)].includes(key)) continue
        if (banned.has(kOf(s)) || !inReach(s, c, SW.standReach)) continue
        out.push(s)
      }
    }
  }
  const d = s => (feet ? Math.hypot(s[0] - feet[0], s[1] - feet[1], s[2] - feet[2]) : 0)
  out.sort((a, b) => (feet && kOf(a) === kOf(feet) ? -1 : 0) - (feet && kOf(b) === kOf(feet) ? -1 : 0) || d(a) - d(b) || a[0] - b[0] || a[2] - b[2] || b[1] - a[1])
  return out.slice(0, max)
}

// ---- the siting -----------------------------------------------------------------------------------------------------------------

/** THE ORIENTATIONS a site is tried in: the gate toward home first, then the two sides, then away (`turn` 0..2: the gate's angle
 *  from home in quarter turns, a cost the siting adds -- the parapet's gate must open onto ground within 1 of the rim). Pure. */
const TURNS = Object.freeze({ n: ['n', 'e', 'w', 's'], s: ['s', 'w', 'e', 'n'], e: ['e', 's', 'n', 'w'], w: ['w', 'n', 's', 'e'] })
/** Candidate centres at Chebyshev ringMin..ringMax from home on the SW.step grid, nearest first, each in its four orientations. Pure. */
export function stepwellCandidates (home, { ring = [SW.ringMin, SW.ringMax], step = SW.step } = {}) {
  const out = []
  for (let dx = -ring[1]; dx <= ring[1]; dx += step) for (let dz = -ring[1]; dz <= ring[1]; dz += step) {
    const d = Math.max(Math.abs(dx), Math.abs(dz))
    if (d < ring[0] || d > ring[1]) continue
    const a0 = awayFrom(home, home.x + dx, home.z + dz)
    TURNS[a0].forEach((away, i) => out.push({ x: home.x + dx, z: home.z + dz, away, turn: Math.min(i, 2), d: Math.hypot(dx, dz) }))
  }
  return out.sort((a, b) => a.d - b.d || a.x - b.x || a.z - b.z || a.turn - b.turn)
}
/** stepwell-03: THE RESERVATIONS a footprint's GAP ring may overlap -- a wall's zones (wall.mjs: its columns + 1, so a gap there
 *  still leaves the tank two columns off the wall's own cells; a record CELL reads `project` and is refused everywhere). LIVE 11-05:
 *  the extension's west line (x -41..-36) took the one free site's gap (-52,-74; owner-approved): with it the tank sits at -54,-74. */
export const GAP_OK = /^project:(wall|wallext)$/
/** The footprint + gap's reservations -> 'reserved:<why>' | 'zone:<kind>' | null: the first refusal in the survey's own column
 *  order (u, then v). Pure over blocked / zoneOf. */
export function reservedFor (origin, away, W, gp, { blocked = () => null, zoneOf = null, gapOk = GAP_OK } = {}) {
  for (let u = -gp; u < W + gp; u++) for (let v = -gp; v < W + gp; v++) {
    const w = toWorld(origin, away, u, v)
    const inside = u >= 0 && v >= 0 && u < W && v < W
    const why = blocked(w.x, w.z)
    // a column's reasons may be several ('|'-joined: treefarm.mjs farmBlocked whys): the gap passes only when EVERY one is a wall's
    if (why && (inside || !(gapOk && String(why).split('|').every(w => gapOk.test(w))))) return `reserved:${why}`
    if (zoneOf && inside && !STEPWELL_ZONES.includes(zoneOf(w.x, w.z))) return `zone:${zoneOf(w.x, w.z)}`
  }
  return null
}
/** stepwell-03: a column function memoised for one siting (blocked, zoneOf: four orientations and the step-2 grid ask each column
 *  many times). Pure wrapper. */
export function columnMemo (fn) {
  if (typeof fn !== 'function') return fn
  const m = new Map()
  return (x, z) => { const k = `${x},${z}`; if (m.has(k)) return m.get(k); const v = fn(x, z); m.set(k, v); return v }
}
/** stepwell-03: a block reader memoised for one siting, bounded at `max` entries (shaftvisit.mjs stairRead clears its own at 4,096:
 *  one candidate reads ~15,000 cells, so every candidate read the world afresh). Pure wrapper. */
export function sitingRead (read, max = 600_000) {
  const m = new Map()
  return (x, y, z) => { const k = `${x},${y},${z}`; if (m.has(k)) return m.get(k); const v = read(x, y, z); if (m.size >= max) m.clear(); m.set(k, v); return v }
}
const TREEISH = /_(log|wood|leaves|stem)$|^(mangrove_roots|bamboo|cactus|mushroom_stem|brown_mushroom_block|red_mushroom_block)$/
const ORE = /_ore$|^ancient_debris$/
const SOFT = /^(dirt|grass_block|coarse_dirt|podzol|rooted_dirt|mycelium|mud|clay|gravel|sand|red_sand|moss_block|snow_block|dirt_path|farmland)$/
/**
 * SURVEY ONE CANDIDATE -> { ok, why, site, g, counts: { cut, dug, faces, soft, ore, cave, water, lava, falling, fill }, byTier }. Pure
 * over read. The footprint (W x W) and a SW.gap margin: never `blocked(x, z)` (zones, records, corridors, plan cells), outside the
 * zone kinds `zoneOf(x, z)` allows (STEPWELL_ZONES); its ground within g - groundDown .. g + groundUp of the rim level g (the rim's
 * most common ground), dry, no log or leaf up to treeH over it. Then the tank for `tiersMax` tiers: every cell to cut and every cell
 * beside one read -- LAVA anywhere refuses (the tiers above it are never planned onto it); water and caves are counted (sealed and
 * laid by the visit); `tiers` is the deepest tier count with no water in its cut cells or their faces (>= SW.tiers or refused 'wet').
 */
export function surveyStepwell (read, home, cand, { blocked = () => null, zoneOf = null, W = SW.W, tiersMax = SW.tiersMax, tiers = SW.tiers, treesOk = false, pondMax = 0, gapOk = GAP_OK } = {}) {
  const away = cand.away
  const origin = originFor(cand.x, cand.z, away, W)
  const gp = SW.gap
  const grounds = []
  const logs = new Set(), trunks = new Set()
  const outer = []
  // stepwell-03: THE RESERVATIONS FIRST, every column of the footprint + its gap, before any read of the world (a candidate the
  // town has taken costs no block read: LIVE 11-05 the siting read the world first and its 25 s ran out at 10,891 of 21,600
  // candidates, the one free site at 19,560). The GAP ring may lie in a wall's own margin zone (GAP_OK): the footprint never does
  const res = reservedFor(origin, away, W, gp, { blocked, zoneOf, gapOk })
  if (res) return { ok: false, why: res }
  for (let u = -gp; u < W + gp; u++) for (let v = -gp; v < W + gp; v++) {
    const w = toWorld(origin, away, u, v)
    const inside = u >= 0 && v >= 0 && u < W && v < W
    if (!inside) {
      // the ring just outside the rim (u or v = -1 or W): its ground is read for the rim's outer edge (below)
      if (u >= -1 && v >= -1 && u <= W && v <= W) {
        const gx = groundTop(read, w.x, w.z, home.y + 24, home.y - 24)
        if (!gx) return { ok: false, why: 'unknown' }
        outer.push({ u, v, y: gx.y, wet: !!gx.wet, x: w.x, z: w.z })
      }
      continue
    }
    const gt = groundTop(read, w.x, w.z, home.y + 24, home.y - 24)
    if (!gt) return { ok: false, why: 'unknown' }
    if (gt.wet && (!pondMax || u < SW.band || v < SW.band || u >= W - SW.band || v >= W - SW.band)) return { ok: false, why: 'wet_ground' }
    for (let y = gt.y + 1; y <= gt.y + SW.treeH; y++) { const b = read(w.x, y, w.z); if (!b) return { ok: false, why: 'unknown' }; if (TREEISH.test(nm(b))) { if (!treesOk) return { ok: false, why: 'trees' }; logs.add(`${w.x},${w.z}`); if (/_log$/.test(nm(b))) trunks.add(`${w.x},${w.z}`) } }
    const r = Math.min(u, v, W - 1 - u, W - 1 - v)
    grounds.push({ u, v, y: gt.y, rim: r < SW.band })
  }
  const hist = new Map()
  for (const q of grounds) if (q.rim) hist.set(q.y, (hist.get(q.y) ?? 0) + 1)
  const g = [...hist.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0]
  // THE GATE'S FRONT: the parapet walls the rim's outside everywhere but the 2-wide gate, whose outside ground (the exit's floor) may
  // be at most 1 below the rim (Codex r1 BLOCKER 3) -- and not above it by more than 1 (the way in)
  // (Codex r2: and DRY and SOLID, with open feet and head over it -- water's surface is no floor; the exit's feet are that floor + 1)
  const cg = (W - 1) / 2
  const fronts = outer.filter(q => q.v === -1 && (q.u === cg - 1 || q.u === cg))
  for (const q of fronts) {
    if (q.wet || q.y < g - 1 || q.y > g + 1) return { ok: false, why: 'gate_step' }
    const fl = read(q.x, q.y, q.z), f = read(q.x, q.y + 1, q.z), h = read(q.x, q.y + 2, q.z)
    if (!fl || !f || !h) return { ok: false, why: 'unknown' }
    if (!isFull(fl) || isFalling(fl) || !isOpen(f) || !isOpen(h)) return { ok: false, why: 'gate_step' }
  }
  const exitY = (fronts.find(q => q.u === cg)?.y ?? g) + 1
  // the rim within groundDown (its `under` cell fills one) .. groundUp (cut); inside the rim the tank is cut below g anyway
  for (const q of grounds) if (q.y > g + SW.groundUp || q.y < g - (q.rim ? SW.groundDown : SW.innerDown)) return { ok: false, why: q.y > g ? 'too_high' : 'too_low' }
  const T = Math.min(tiersMax, tiersFit(W))
  const plan = planTank({ origin, away, g, W, T })
  const counts = { cut: 0, dug: 0, faces: 0, soft: 0, ore: 0, cave: 0, water: 0, pond: 0, lava: 0, falling: 0, fill: 0 }
  const byTier = {}
  const tierOf = y => (y > g ? 1 : tierOfY(g, y))
  const bump = (t, k) => { (byTier[t] ??= { dug: 0, soft: 0, ore: 0, cave: 0, water: 0, lava: 0, falling: 0, faces: 0 })[k]++ }
  const ground = new Map()
  for (const q of grounds) { const w = toWorld(origin, away, q.u, q.v); ground.set(`${w.x},${w.z}`, q.y) }
  const wetTier = new Set()
  for (const c of plan.cut) {
    const b = read(...c.at)
    if (!b) return { ok: false, why: 'unknown' }
    counts.cut++
    const t = tierOf(c.at[1])
    if (isLava(b)) return { ok: false, why: `lava:${c.at[1]}` }
    if (isWet(b)) { counts.water++; counts.pond++; bump(t, 'water'); if (counts.pond > pondMax) wetTier.add(t) } else if (!isOpen(b)) {
      counts.dug++; bump(t, 'dug')
      if (ORE.test(nm(b))) { counts.ore++; bump(t, 'ore') }
      if (isFalling(b)) { counts.falling++; bump(t, 'falling') }
    } else if (c.at[1] <= g) {
      // open below the rim: a cave (above the column's natural ground it is just air)
      if (c.at[1] <= (ground.get(`${c.at[0]},${c.at[2]}`) ?? g)) { counts.cave++; bump(t, 'cave') }
    }
    for (const [dx, dy, dz] of N6) {
      const n = [c.at[0] + dx, c.at[1] + dy, c.at[2] + dz]
      if (plan.cutKeys.has(kOf(n))) continue
      const nb = read(...n)
      if (!nb) return { ok: false, why: 'unknown' }
      if (isLava(nb)) return { ok: false, why: `lava:${n[1]}` }
      if (isWet(nb)) { const inRec = plan.byKey.has(kOf(n)); counts.water++; bump(t, 'water'); if (!inRec || !pondMax) wetTier.add(t) }
    }
  }
  for (const e of plan.cells) {
    const b = read(...e.at)
    if (!b) return { ok: false, why: 'unknown' }
    if (isLava(b)) return { ok: false, why: `lava:${e.at[1]}` }
    const t = e.t || 1
    if (e.role === 'wall' || e.role === 'floor' || e.role === 'trim') {
      counts.faces++; bump(t, 'faces')
      if (SOFT.test(nm(b))) { counts.soft++; bump(t, 'soft') }
      if (ORE.test(nm(b))) { counts.ore++; bump(t, 'ore') }
    }
    if ((e.role === 'body' || e.role === 'under' || e.role === 'wall' || e.role === 'floor' || e.role === 'trim') && (isOpen(b) || isWet(b))) { counts.fill++; if (isWet(b)) { counts.water++; bump(t, 'water'); if (!pondMax) wetTier.add(t) } else if (e.role !== 'floor' && e.role !== 'trim') { counts.cave++; bump(t, 'cave') } }
  }
  let dryTiers = 0
  for (let t = 1; t <= T; t++) { if (wetTier.has(t)) break; dryTiers = t }
  if (dryTiers < tiers) return { ok: false, why: `wet:tier${dryTiers + 1}`, counts, byTier }
  counts.treeCols = logs.size
  counts.trunks = trunks.size
  return { ok: true, why: null, site: { origin, away, g, W, T: Math.min(tiers, dryTiers), centre: [cand.x, cand.z], tiersDry: dryTiers, exitY }, g, counts, byTier, d: cand.d, turn: cand.turn ?? 0 }
}
/**
 * DO THE FELLING'S STANDS FIT THE TANK? -> null | why. Pure. A stand step on one of the tank's own cells (a rim post, a light, a head)
 * would be dropped from the record and its tree never felled; one above the cut top would never be cut back down and the tank never
 * complete (Claude r1 BLOCKERS 1-2): either refuses the site.
 */
export function standsFit (site, platforms = []) {
  const P = planTank(site)
  for (const q of platforms ?? []) {
    for (const c of q.cells ?? []) {
      if (P.byKey.has(kOf(c))) return 'stand_on_cell'
      if (c[1] > P.top) return 'stand_above_cut'
    }
  }
  return null
}
/** THE BETTER OF TWO SURVEYS: the fewest soft faces + caves to lay (the stone the tank needs), then the nearest home. Pure. */
export function stepwellBetter (a, b) {
  if (!a) return b
  if (!b) return a
  const cost = s => s.counts.soft + s.counts.cave + s.counts.fill + 4 * s.counts.water + 20 * (s.counts.trunks ?? 0) + 40 * (s.turn ?? 0)
  return cost(b) < cost(a) || (cost(b) === cost(a) && b.d < a.d) ? b : a
}

// ---- the record -----------------------------------------------------------------------------------------------------------------

/** THE RECORD from a survey -> the stepwell record (buildproj publishRecord's value). Pure. */
export function stepwellRecord (sv, { home, seed = 0, now = Date.now(), by = null, fell = null, read = null } = {}) {
  const stands = (fell?.platforms ?? []).flatMap(q => q.cells)
  // THE CUT LIST: every cell from a column's top up to g + CUT_OPEN (the walkways' head room and the pit's whole volume: a block
  // left there later is cut), above that only what stood at siting (terrain and trunks to fell; the open sky is not listed)
  const g0 = sv.site.g
  const plan = planTank({ ...sv.site, stands }, { cutKeep: c => c[1] <= g0 + CUT_OPEN || !read || !isOpen(read(...c) ?? { boundingBox: 'block' }) })
  const palette = paletteFor(seed)
  const g = plan.g
  const [x0, z0, x1, z1] = plan.box
  const deep = g - SW.tierD * (sv.site.tiersDry ?? plan.T) - 2
  return {
    v: SW.v, blueprint: STEPWELL_BLUEPRINT, plot: STEPWELL_PLOT, home,
    site: { origin: sv.site.origin, away: sv.site.away, g, W: plan.W, T: plan.T, centre: sv.site.centre, tiersDry: sv.site.tiersDry ?? plan.T, stands, cutTop: g + CUT_OPEN, ...(Number.isInteger(sv.site.exitY) ? { exitY: sv.site.exitY } : {}), ...(sv.site.descent ? { descent: sv.site.descent } : {}) },
    seed, palette,
    cells: plan.cells.map(e => ({ at: e.at, role: e.role, t: e.t, ...(e.d ? { d: 1 } : {}), ...(e.role === 'stand' ? { seg: FELL_SEG } : {}) })),
    clear: fellClear(plan, fell),
    trees: (fell?.trees ?? []).map(t => ({ base: t.base, name: t.name, top: t.top })),
    replant: (fell?.replant ?? []).map((r, i) => ({ ...r, tree: i })),
    box: [x0, z0, x1, z1],
    // THE RESERVATION (shop.mjs recordZones reads a record's own `zones`): the footprint + its gap, every height (nothing else is sited
    // there, above or below: the deeper tiers and the descent under the court are this project's); `deep` the surveyed dry depth
    zones: [{ box: [x0 - SW.gap, -64, z0 - SW.gap, x1 + SW.gap, 320, z1 + SW.gap], why: 'project:stepwell' }], deep,
    exit: plan.exit, tiers_built: [], survey: sv.counts, byTier: sv.byTier,
    builders_max: STEPWELL_BUILDERS, structure_complete: false, state: 'open', sitedAt: now, sitedBy: by,
  }
}
// ---- the felling (the site's trees: plotPrep's trees and stands, replantCells' saplings -- the caller computes them) ---------------

export const FELL_SEG = 'stand'
/** The cut list's always-listed height above the rim: the pit's volume and the rim's head room. */
export const CUT_OPEN = 3
/** The stands' blocks (any of the bag's scaffold stone; runVisit's palette for the stand role). */
export const FELL_PALETTE = Object.freeze({ stand: Object.freeze(['cobblestone', 'cobbled_deepslate', 'stone', 'andesite', 'diorite', 'granite', 'dirt']) })
/** THE CLEAR LIST: the tank's cuts (kind cut) and the felling's logs and leaves (kind tree / leaves, a log's `tree` its index) -- a
 *  log or leaf in a cut cell is listed once, as the felling's. Pure. */
export function fellClear (plan, fell) {
  const out = []
  const seen = new Set()
  for (const c of fell?.clear ?? []) {
    const k = kOf(c.at)
    if (seen.has(k) || (plan.byKey.has(k) && plan.byKey.get(k).role !== 'stand')) continue
    seen.add(k)
    out.push({ at: c.at, kind: c.kind, name: c.name, ...(c.tree != null ? { tree: c.tree } : {}), t: 0 })
  }
  for (const c of plan.cut) if (!seen.has(kOf(c.at))) out.push({ at: c.at, kind: 'cut', t: c.t, ...(c.d ? { d: 1 } : {}) })
  return out
}
/**
 * THE FELLING'S VISIT RECORD -> the record runVisit (buildrun.mjs) works: the stands as its only cells (segment `stand`), the trees'
 * logs and leaves as its clears, the record's replants (B4: every sapling planted before a trunk is felled; its `saplings=a/b` rows
 * count the HEAD record's replants, the tripwire's G5). Pure.
 */
export function fellView (rec) {
  return { ...rec, cells: (rec.cells ?? []).filter(c => c.role === 'stand').map(c => ({ at: c.at, role: 'stand', seg: FELL_SEG })),
    clear: (rec.clear ?? []).filter(c => c.kind === 'tree' || c.kind === 'leaves'), segments: [{ seg: FELL_SEG, deps: [] }] }
}
/** IS THE FELLING STILL OWED? -> the count of the record's logs still standing (0: the tank may be cut), or null (unread). Pure. */
export function fellPending (read, rec) {
  let n = 0
  for (const c of rec.clear ?? []) {
    if (c.kind !== 'tree') continue
    const b = read(...c.at)
    if (!b) return null
    if (/_(log|wood)$/.test(nm(b))) n++
  }
  return n
}

/** THE PLAN OF A RECORD (memo per record object). Pure. */
const planMemo = new WeakMap()
export function planOfRecord (rec) {
  if (!planMemo.has(rec)) {
    // the record's own clear list is the plan's cuts (never a cell the record does not list: the tripwire's G2)
    const top = rec.site?.cutTop ?? Infinity
    const listed = new Set((rec.clear ?? []).filter(c => c.kind === 'cut' || c.at[1] <= top).map(c => kOf(c.at)))
    const p = planTank(rec.site, { cutKeep: c => listed.has(kOf(c)) })
    // a seal only in a cut cell of kind cut (the tripwire's SW1): a felled log's or leaf's cell is cut, never sealed (Claude r1 BLOCKER 3)
    p.sealKeys = new Set((rec.clear ?? []).filter(c => c.kind === 'cut').map(c => kOf(c.at)))
    planMemo.set(rec, p)
  }
  return planMemo.get(rec)
}
/** IS A STANDING TANK DAMAGED? -> the first undone unit's height, or null. Pure. */
export function stepwellDamaged (read, rec, { lights = false } = {}) {
  if (rec?.state === 'stopped') return null
  const w = firstUndoneUnit(read, planOfRecord(rec), { lights })
  return w && !w.unknown ? w.unit.y : null
}
/** IS THE DESCENT BUILT? -> true when the plan has one and every cut and cell of it (tier T + 1, torches aside) reads done. Pure. */
export function descentDone (read, plan) {
  if (!plan.descent) return false
  return plan.cells.every(e => !e.d || e.role === 'dlight' || cellDone(read, plan, e.at) === true) && plan.cut.every(c => !c.d || cellDone(read, plan, c.at) === true)
}
/**
 * THE DESCENT'S WALK PROOF -> { ok, problems }. Pure over the plan alone (the world as built): every stand of the path has a tread under
 * it and two air cells over it; consecutive stands are within 1 up or down and at most 3 apart along the lane; a stand a step BELOW
 * the next one (an ascent's jump) has a third air cell. The path starts at the portal and ends on the bottom landing.
 */
export function descentCheck (plan) {
  const D = plan.descent
  if (!D) return { ok: false, problems: ['no descent'] }
  const air = new Set([...D.air, ...D.portal].map(kOf))
  const solid = new Set(D.treads.map(kOf))
  const problems = []
  // THE WAY IN: the court's feet and head in front of the portal are the tank's open cuts, never a record cell
  for (const c of D.court ?? []) for (const y of [c[1], c[1] + 1]) {
    const k = k3(c[0], y, c[2])
    if (plan.byKey.has(k) || !plan.cutKeys.has(k)) problems.push(`the way in is shut at ${k}`)
  }
  if (!(D.court ?? []).length) problems.push('no way in')
  D.path.forEach((p, i) => {
    if (!solid.has(k3(p[0], p[1] - 1, p[2]))) problems.push(`no tread under ${kOf(p)}`)
    if (!air.has(kOf(p)) || !air.has(k3(p[0], p[1] + 1, p[2]))) problems.push(`no room at ${kOf(p)}`)
    const q = D.path[i + 1]
    if (!q) return
    if (Math.abs(q[1] - p[1]) > 1) problems.push(`step ${q[1] - p[1]} at ${kOf(p)}`)
    if (Math.abs(q[0] - p[0]) + Math.abs(q[2] - p[2]) > 4) problems.push(`gap at ${kOf(p)}`)
    if (q[1] < p[1] && !air.has(k3(q[0], q[1] + 2, q[2]))) problems.push(`no jump room at ${kOf(q)}`)
  })
  return { ok: !problems.length, problems }
}
/** The tiers built -> [t]: tier t stands when every record cell of bands 0..t and every cut of tiers 1..t reads done. Pure. */
export function tiersDone (read, plan) {
  const out = []
  for (let t = 1; t <= plan.T; t++) {
    const ok = plan.cells.every(e => e.d || e.t > t || e.role === 'light' || cellDone(read, plan, e.at) === true) && plan.cut.every(c => c.d || c.t > t || cellDone(read, plan, c.at) === true)
    if (!ok) break
    out.push(t)
  }
  return out
}
/**
 * THE RECORD STOPPED (lava anywhere a cut would open, or water outside the record): the tank stands as built and is never cut deeper
 * -- state 'stopped', complete; nothing is removed from the record (every cell stays protected); a later generation (a design
 * decision, not a reflex) re-plans it. -> record. Pure.
 */
export function stepwellStopped (rec, { y = null, why = null, now = Date.now() } = {}) {
  return { ...rec, state: 'stopped', structure_complete: true, stopAt: now, stopWhy: why, stopY: y, completeAt: now }
}
/** The bill of a plan (blocks to place at most, by role) -> { floor, trim, wall, post, light, solid }. Pure. */
export function stepwellBill (plan) {
  const n = {}
  for (const e of plan.cells) n[e.role] = (n[e.role] ?? 0) + 1
  return n
}
/** The detail of a `_stepwell` row. Pure. */
export const stepwellRow = d => ['op', 'y', 't', 'at', 'why', 'n', 'ms', 'gen'].map(k => `${k}=${d[k] == null ? '-' : Array.isArray(d[k]) ? d[k].join(',') : String(d[k]).replace(/\s+/g, '_').slice(0, 80)}`).join(' ')
