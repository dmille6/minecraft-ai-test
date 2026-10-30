// THE ZIGGURAT (monument-01 on the one trunk, 2026-10-29; OWNER 10-15 "a SOLID ziggurat per world, by layers", approved 10-19
// as the bots' first multi-bot group monument; OWNER 10-29: build it on the SHOWCASE now, then the fleet). PURE: the geometry,
// the site, the record and the switch. Nothing here touches a bot or a file.
//
// WHAT CHANGED FROM THE 10-15 monument-01 (branches monument-on-835ef3f & co, all on the dead minewell-01 lineage): that build
// carried its own builder (builder.mjs), its own record files, its own job and structureguard's hooks into minewell's stair
// planner. The trunk now has all of that from shop-01 -- buildproj.mjs (records, slots, segment leases, intents, the mutex),
// buildrun.mjs (the visit: bottom-up, nearest-first, foreign-block clears, stuck cells), buildbot.mjs (the server-witnessed
// clicks) -- and mine's keep-out already composes the workshop's record cells (skills.mjs shopKeepOut, minewell
// composeKeepOut). So the ziggurat is a SECOND PROJECT on that machinery: this file turns the geometry into a project record
// (cells, roles, segments) and the build visit is buildrun.mjs runVisit, unchanged in kind. Nothing of minewell is needed.
//
// SHAPE (10-15 design, Z defaults): a B x B base, square tiers H high stepping in S per side; sides B, B-2S, ... down to >= 2S.
// Every cell rests on the cell below (solid by layers). THE GRAND STAIR: one full block per tier at the foot of each tier wall,
// on the face toward home, STAIR_W wide -- every climb on the finished structure is +1, every drop <= H.
//
// ROLES: `skin` (the 26-adjacent exposed shell: cobblestone, what the camera sees), `core` (inside: ANY full solid counts as
// done -- natural ground the site absorbs stays where it is, and the builder may fill with cobblestone, cobbled deepslate,
// dirt or the stone variants a bag carries), `stair` (cobblestone). Foundation fill under low columns is `core`, except where it
// shows (under the base's outer ring, under the stair, the approach): `skin`.
//
// SEGMENTS: one per (layer, quadrant) -- `L03-N` -- so up to four builders work a layer at once on cells no other segment
// shares; every segment of layer L waits on every segment of layer L-1 (the layer barrier: a cell is placed only on a finished
// layer). The foundation is segment `F`, first.

import { sectorExtent } from './townplan.mjs'

export const ZIG_DEFAULT = Object.freeze({ B: 48, S: 3, H: 2, STAIR_W: 3 })
/** The showcase's first monument (OWNER 10-29: built now, on what the town can supply -- see SIZE below). */
export const ZIG_SHOWCASE = Object.freeze({ B: 30, S: 3, H: 2, STAIR_W: 3 })
export const MONUMENT_BLUEPRINT = 'ziggurat@1'
/** ZIGGURAT V2 (OWNER 10-29 "Let's do 1 to 3"): a design per town -- shape knobs, a palette the town can pay for, details --
 *  chosen ONCE at siting from the town's seed (zigdesign.mjs) and written into the record (`palette`, `design`). */
export const MONUMENT_BLUEPRINT_V2 = 'ziggurat@2'
/** Is this a ziggurat record's blueprint (either version)? Pure. */
export const isZigBlueprint = id => id === MONUMENT_BLUEPRINT || id === MONUMENT_BLUEPRINT_V2
export const MONUMENT_PLOT = 'monument'
export const MONUMENT_BUILDERS = 3
/** What the visit places, by role. `*solid` = any full solid reads done (buildrun.mjs cellDone). */
export const ZIG_PALETTE = Object.freeze({
  skin: ['cobblestone'],
  stair: ['cobblestone'],
  core: ['*solid', 'cobblestone', 'cobbled_deepslate', 'dirt', 'andesite', 'diorite', 'granite', 'tuff', 'stone', 'coarse_dirt'],
})
/** What a visit may dig out of an open record cell (buildrun.mjs foreignKind, widened for a forest floor): terrain, and the plants
 *  a placement does not replace (offline on the showcase region 10-29: a sapling and a mushroom in two foundation cells stopped
 *  the foundation `blocked`), a stray torch, and every block the pathfinder scaffolds with (scaffold.mjs PATHFINDER_SCAFFOLD + its
 *  dirt and cobblestone; logs are TREE_CLEAR) -- an open cell takes the pathfinder's scaffold (shop.mjs footprintCost), and one in a
 *  skin or stair cell is dug and replaced (Codex r6 BLOCK 2). */
export const ZIG_FOREIGN = /^(cobblestone|dirt|coarse_dirt|grass_block|podzol|rooted_dirt|mycelium|moss_block|stone|andesite|diorite|granite|tuff|netherrack|cobbled_deepslate|deepslate|gravel|sand|red_sand|clay|mud|snow_block|packed_ice|mossy_cobblestone|calcite|dripstone_block|smooth_basalt|[a-z_]+_sapling|mangrove_propagule|brown_mushroom|red_mushroom|dandelion|poppy|[a-z_]+_tulip|azure_bluet|oxeye_daisy|cornflower|lily_of_the_valley|allium|blue_orchid|sunflower|lilac|rose_bush|peony|sweet_berry_bush|bush|firefly_bush|leaf_litter|wildflowers|pink_petals|moss_carpet|short_dry_grass|tall_dry_grass|torchflower|cactus_flower|pitcher_plant|snow|torch|wall_torch|[a-z_]+_planks|sandstone|red_sandstone|blackstone|basalt)$/

/** THE PALETTE A RECORD IS BUILT AND JUDGED WITH: a v2 record carries its own (zigdesign.mjs); a v1 record -- the showcase's
 *  sited ziggurat@1 -- has none and keeps ZIG_PALETTE, the very object it was built with. Pure. */
export function zigPaletteOf (rec) {
  return rec?.blueprint === MONUMENT_BLUEPRINT_V2 && rec?.palette && typeof rec.palette === 'object' ? rec.palette : ZIG_PALETTE
}

/**
 * THE SWITCH -> bool. MONUMENT=on|off; unset = on only in the pools named by MONUMENT_POOLS (default 'showcase'): the fleet's
 * towns keep their workshop-only build job until the fleet rollout turns it on. Pure.
 */
export function monumentOn (env = process.env, pool = '') {
  const v = String(env?.MONUMENT ?? '').toLowerCase()
  if (v === 'on' || v === '1' || v === 'true') return true
  if (v === 'off' || v === '0' || v === 'false') return false
  const pools = String(env?.MONUMENT_POOLS ?? 'showcase').split(',').map(s => s.trim()).filter(Boolean)
  return pools.includes(String(pool))
}
/** The geometry for a pool: MONUMENT_B (an even side, 12..48) overrides; the showcase's default is ZIG_SHOWCASE. Pure. */
export function zigFor (env = process.env, pool = '') {
  const b = Number(env?.MONUMENT_B)
  const base = pool === 'showcase' ? ZIG_SHOWCASE : ZIG_DEFAULT
  if (Number.isInteger(b) && b >= 12 && b <= 48 && b % 2 === 0) return Object.freeze({ ...base, B: b })
  return base
}

/** Tier sides for a geometry, widest first. Pure. */
export function tierSides ({ B, S, TIERS } = ZIG_DEFAULT) {
  const out = []
  for (let L = B; L >= 2 * S && L > 0; L -= 2 * S) out.push(L)
  // v2: TIERS caps the count (a truncated ziggurat: a broad summit for its shrine); v1 geometries have none
  return Number.isInteger(TIERS) && TIERS > 0 ? out.slice(0, TIERS) : out
}
/** Layers of solid structure above the base at column offset (i, j) from the NW corner (0..B-1); 0 outside. Pure. */
export function profileAt (i, j, g = ZIG_DEFAULT) {
  const sides = tierSides(g)
  let layers = 0
  for (let t = 0; t < sides.length; t++) {
    const o = t * g.S
    if (i >= o && i < g.B - o && j >= o && j < g.B - o) layers = (t + 1) * g.H
  }
  return layers
}
/** The finished height in layers. Pure. */
export const zigHeight = g => tierSides(g).length * g.H
/** The face toward home for a site centre: 'n' | 's' | 'e' | 'w'. Pure. */
export function faceToward (centre, home) {
  const dx = home.x - centre.x, dz = home.z - centre.z
  return Math.abs(dx) >= Math.abs(dz) ? (dx > 0 ? 'e' : 'w') : (dz > 0 ? 's' : 'n')
}
/** The quadrant of column offset (i, j) around the base's centre -> 'N' | 'E' | 'S' | 'W' (ties: N/S first). Pure. */
export function quadrantOf (i, j, g = ZIG_DEFAULT) {
  const c = (g.B - 1) / 2, dx = i - c, dz = j - c
  if (Math.abs(dz) >= Math.abs(dx)) return dz < 0 ? 'N' : 'S'
  return dx > 0 ? 'E' : 'W'
}
export const segName = (layer, q) => `L${String(layer).padStart(2, '0')}-${q}`
const FACE_Q = { n: 'N', s: 'S', e: 'E', w: 'W' }
/** The stair faces: the face toward home, or (v2, FACES 4) all four. Pure. */
export const facesOf = (g, face) => (g?.FACES === 4 ? ['n', 'e', 's', 'w'] : [face])
/**
 * THE STAIR'S STEPS for tier t on a face -> [{ i, j, d, h }]: STAIR_W columns, centred, at distance d = 1 .. H-1 outside tier t's
 * wall, each a stack h = H - d high from the layer t*H -- every climb +1 (H 2: one step of one block, the v1 grand stair exactly;
 * H 3: a 2-high step against the wall and a 1-high step before it). Pure.
 */
export function stairSteps (t, face, g = ZIG_DEFAULT) {
  const o = t * g.S, w0 = Math.floor((g.B - g.STAIR_W) / 2), out = []
  for (let d = 1; d <= Math.max(1, g.H - 1); d++) {
    for (let w = 0; w < g.STAIR_W; w++) {
      const a = w0 + w
      const [i, j] = { s: [a, g.B - o - 1 + d], n: [a, o - d], e: [g.B - o - 1 + d, a], w: [o - d, a] }[face]
      out.push({ i, j, d, h: Math.max(1, g.H - d) })
    }
  }
  return out
}
/** The stair cells' column offsets (i, j) for tier t on a face (one outside tier t's footprint), STAIR_W wide, centred. Pure. */
export function stairCols (t, face, g = ZIG_DEFAULT) {
  const o = t * g.S, w0 = Math.floor((g.B - g.STAIR_W) / 2), out = []
  for (let w = 0; w < g.STAIR_W; w++) {
    const a = w0 + w
    out.push({ s: [a, g.B - o], n: [a, o - 1], e: [g.B - o, a], w: [o - 1, a] }[face])
  }
  return out
}

/**
 * THE BODY -> [{ at: [x, y, z], role, seg, layer }] in build order (layer by layer; within a layer the quadrants N, E, S, W).
 * corner = the NW corner { x, z } (offset (0, 0)); baseY = the y of layer 0; face = the stair face. Pure.
 */
export function zigCells ({ corner, baseY, face = 's' }, g = ZIG_DEFAULT) {
  const top = zigHeight(g), sides = tierSides(g)
  const solid = (i, l, j) => l >= 0 && l < profileAt(i, j, g)
  const exposed = (i, l, j) => {
    for (let di = -1; di <= 1; di++) for (let dl = -1; dl <= 1; dl++) for (let dj = -1; dj <= 1; dj++) {
      if ((!di && !dl && !dj) || l + dl < 0) continue
      if (!solid(i + di, l + dl, j + dj)) return true
    }
    return false
  }
  const stairs = new Map()
  // every step stack of every stair face (v1: one face, one block a step -- the same cells in the same order as before)
  for (let t = 0; t < sides.length; t++) {
    for (const f of facesOf(g, face)) {
      for (const st of stairSteps(t, f, g)) for (let k = 0; k < st.h; k++) stairs.set(t * g.H + k, [...(stairs.get(t * g.H + k) ?? []), [st.i, st.j, FACE_Q[f]]])
    }
  }
  const out = []
  for (let l = 0; l < top; l++) {
    const layer = []
    for (let i = 0; i < g.B; i++) for (let j = 0; j < g.B; j++) {
      if (!solid(i, l, j)) continue
      layer.push({ at: [corner.x + i, baseY + l, corner.z + j], role: exposed(i, l, j) ? 'skin' : 'core', seg: segName(l, quadrantOf(i, j, g)), layer: l })
    }
    for (const [i, j, q] of stairs.get(l) ?? []) layer.push({ at: [corner.x + i, baseY + l, corner.z + j], role: 'stair', seg: segName(l, q), layer: l })
    const qi = { N: 0, E: 1, S: 2, W: 3 }
    layer.sort((a, b) => qi[a.seg.slice(-1)] - qi[b.seg.slice(-1)])
    out.push(...layer)
  }
  return out
}
/**
 * THE SEGMENTS OF A v2 RECORD'S CELLS -> [{ seg, deps }] (zigdesign.mjs: shrine layers above the summit hold only some quadrants;
 * the details -- lights, the fire -- are the `D-<q>` segments, last). `F` first; each layer's present quadrants wait on every
 * segment of the layer below that has cells (the layer barrier); `D-*` waits on the top layer. Pure.
 */
export function zigSegmentsOf (cells) {
  const Q = ['N', 'E', 'S', 'W']
  const has = new Set(cells.map(c => c.seg))
  const out = has.has('F') ? [{ seg: 'F', deps: [] }] : []
  const layers = [...new Set(cells.filter(c => /^L\d\d-/.test(c.seg)).map(c => Number(c.seg.slice(1, 3))))].sort((a, b) => a - b)
  let prev = has.has('F') ? ['F'] : []
  for (const l of layers) {
    const segs = Q.map(q => segName(l, q)).filter(sg => has.has(sg))
    for (const sg of segs) out.push({ seg: sg, deps: prev })
    prev = segs
  }
  const D = Q.map(q => `D-${q}`).filter(sg => has.has(sg))
  for (const sg of D) out.push({ seg: sg, deps: prev })
  return out
}
/** The segments of a body -> [{ seg, deps }]: `F` first (when there is foundation), then every layer's quadrants, each waiting
 *  on the whole layer below. Pure. */
export function zigSegments (g = ZIG_DEFAULT, { foundation = false } = {}) {
  const out = foundation ? [{ seg: 'F', deps: [] }] : []
  const Q = ['N', 'E', 'S', 'W']
  for (let l = 0; l < zigHeight(g); l++) {
    const deps = l === 0 ? (foundation ? ['F'] : []) : Q.map(q => segName(l - 1, q))
    for (const q of Q) out.push({ seg: segName(l, q), deps })
  }
  return out
}

// ---- the site --------------------------------------------------------------------------------------------------------------

const nm = b => String(b?.name ?? '').replace(/\[.*\]$/, '')
const PLANT = /^(air|cave_air|void_air|short_grass|tall_grass|grass|fern|large_fern|dead_bush|dandelion|poppy|.*_tulip|azure_bluet|oxeye_daisy|cornflower|lily_of_the_valley|allium|blue_orchid|sunflower|lilac|rose_bush|peony|snow|sweet_berry_bush|bush|firefly_bush|leaf_litter|wildflowers|pink_petals|.*_mushroom|vine|glow_lichen|moss_carpet|short_dry_grass|tall_dry_grass|cactus_flower|torchflower|pitcher_plant|.*_sapling|mangrove_propagule|torch|wall_torch)$/
const TREE = /(_log|_wood|_leaves|^mangrove_roots|^bamboo|^cactus|^sugar_cane|^cocoa|_mushroom_block|^mushroom_stem)$/
const LIQUID = /^(water|lava|bubble_column)$/
/** Town furniture and anything a site must never be built over: a REFUSAL, never cleared. */
export const FURNITURE = /(chest|barrel|furnace|smoker|crafting_table|_bed$|composter|lectern|trapdoor|_door$|_sign$|anvil|hopper|stonecutter|rail$|bell|brewing_stand|enchanting_table|jukebox|note_block|loom|cartography_table|fletching_table|smithing_table|grindstone|campfire|spawner|bee_nest|beehive|ladder|_fence|_wall$|glass|_pane$|lantern)/
const LITTER = /^crafting_table$/
const full = b => !!b && (b.boundingBox === 'block' || b.boundingBox == null) && !LIQUID.test(nm(b)) && !PLANT.test(nm(b))

/**
 * ONE COLUMN -> { top, logs: [y], why }. Pure. top = the y of the highest full solid that is neither a tree nor furniture, found
 * from yHi down (plants, air, logs and leaves are passed over -- a log, or a field crafting table, is recorded in `logs`: dug); `why` names a refusal: 'unknown' (an unread
 * cell), 'liquid' (water or lava at or above the ground), 'furniture' (a station, a chest, a fence ... at or above the ground).
 */
export function columnOf (read, x, z, { yHi, yLo }) {
  const logs = []
  for (let y = yHi; y >= yLo; y--) {
    const b = read(x, y, z)
    if (!b) return { top: null, logs, why: 'unknown' }
    const n = nm(b)
    if (LIQUID.test(n) || b.name?.includes?.('waterlogged')) return { top: null, logs, why: 'liquid' }
    if (PLANT.test(n)) continue
    if (TREE.test(n)) { if (/_log$|_wood$/.test(n)) logs.push(y); continue }
    // a FIELD crafting table (bot litter: measured 10-29, 3 in the showcase reservation) is dug like a log, never a refusal
    if (LITTER.test(n)) { logs.push(y); continue }
    if (FURNITURE.test(n)) return { top: null, logs, why: 'furniture' }
    if (full(b)) return { top: y, logs, why: null }
  }
  return { top: null, logs, why: 'no_ground' }
}

/**
 * THE FOUNDATION'S DEPTH under an INNER column (offline on the showcase's region, 10-29: a 1-wide pit 4 deep under the base had no
 * stand at all -- its floor is out of reach from the rim, and the only stand inside is the cell itself): at most this many cells
 * under layer 0, side-supported inward from the hollow's edge; a deeper hollow stays a hidden void under the body (a block needs
 * no support). The base's OUTER ring is filled to the ground: it shows.
 */
export const FOUND_DEPTH = 2
export const SITE = Object.freeze({ step: 1, maxFillShare: 0.25, maxCut: 400, margin: 2, apron: 1, approachMax: 4, avoidPad: 3 })
/**
 * THE SITE IN A RESERVATION -> { ok, why, site | null, tried, rejects }. Pure over `col(x, z)` (columnOf results; null =
 * outside the read) and `avoid(x, z)` -> reason | null (the town plan's cells, boxes and paths, protected zones, wells, the
 * farm, another project's record cells + SITE.avoidPad).
 *   box  [x0, z0, x1, z1] the town plan's monument reservation (townplan.mjs sectorExtent): the base + `margin` lies inside it
 *   home { x, y, z }; g the geometry
 * Per corner: every base and apron column read, dry, unfurnished and unavoided; the base height minimises fill + 2 x cut +
 * 2 x redo (fill = cells from a column's ground up to the layer below the base; cut = natural ground ABOVE the finished profile,
 * or above the apron's walking level -- dug by the builder as record clears; redo = ground standing in a SKIN cell, dug and
 * replaced with cobblestone); refused over SITE.maxFillShare of the plan or SITE.maxCut. Logs (and field tables) add one each.
 * Ties: the least work, then the nearest centre to home. The stair faces home.
 */
export function siteZiggurat (col, avoid, { box, home, g = ZIG_DEFAULT, opts = SITE } = {}) {
  // the apron holds every step of the tier-0 stair (v2 H 3: two columns out; v1: one, SITE.apron)
  const B = g.B, M = opts.margin, A = Math.max(opts.apron, (g.H ?? 2) - 1)
  const rejects = {}, out = []
  // each column is judged once (the corners overlap almost entirely)
  const am = new Map(), cm = new Map()
  const av = (x, z) => { const k = x * 4096 + z; if (!am.has(k)) am.set(k, avoid(x, z)); return am.get(k) }
  const cl = (x, z) => { const k = x * 4096 + z; if (!cm.has(k)) cm.set(k, col(x, z)); return cm.get(k) }
  const rel = zigCells({ corner: { x: 0, z: 0 }, baseY: 0 }, g)
  const plan = rel.length
  // the SKIN layers of each column (i, j): natural ground standing in a skin cell is dug and replaced (a dig + a place)
  const skin = new Map()
  for (const c of rel) if (c.role === 'skin') { const k = `${c.at[0]},${c.at[2]}`; if (!skin.has(k)) skin.set(k, []); skin.get(k).push(c.at[1]) }
  for (let x0 = box[0] + M; x0 + B - 1 + M <= box[2]; x0 += opts.step) {
    for (let z0 = box[1] + M; z0 + B - 1 + M <= box[3]; z0 += opts.step) {
      const r = scoreCorner(cl, av, { x: x0, z: z0 }, g, A, home, opts, plan, skin)
      if (!r.ok) { rejects[r.why] = (rejects[r.why] ?? 0) + 1; continue }
      out.push(r)
    }
  }
  if (!out.length) return { ok: false, why: Object.keys(rejects).length ? 'no_site' : 'no_candidates', site: null, tried: 0, rejects }
  const dist = r => Math.hypot(r.centre.x - home.x, r.centre.z - home.z)
  out.sort((a, b) => a.work - b.work || dist(a) - dist(b) || a.corner.x - b.corner.x || a.corner.z - b.corner.z)
  return { ok: true, why: 'ok', site: out[0], tried: out.length, rejects }
}
const edgeOf = (c, g) => c.i === 0 || c.j === 0 || c.i === g.B - 1 || c.j === g.B - 1
/** The tier-0 stair's column offsets on every stair face, every step -> [[i, j, face]] (v1: the one face's STAIR_W columns). */
const stepCols = (face, g) => facesOf(g, face).flatMap(f => stairSteps(0, f, g).map(st => [st.i, st.j, f]))
/** ...its OUTERMOST step only (d = H-1: the step the approach climbs onto; v1: the same columns). */
const footSteps = (face, g) => facesOf(g, face).flatMap(f => stairSteps(0, f, g).filter(st => st.d === Math.max(1, g.H - 1)).map(st => [st.i, st.j, f]))
function scoreCorner (col, avoid, corner, g, A, home, opts, plan, skin = new Map()) {
  const B = g.B
  const centre = { x: corner.x + (B - 1) / 2, z: corner.z + (B - 1) / 2 }
  const face = faceToward(centre, home)
  const base = [], apron = []
  for (let i = -A; i < B + A; i++) for (let j = -A; j < B + A; j++) {
    const x = corner.x + i, z = corner.z + j
    const why = avoid(x, z)
    if (why) return { ok: false, why: `avoid:${why}` }
    const c = col(x, z)
    if (!c) return { ok: false, why: 'unread' }
    if (c.why) return { ok: false, why: c.why }
    const inner = i >= 0 && i < B && j >= 0 && j < B
    ;(inner ? base : apron).push({ i, j, x, z, top: c.top, logs: c.logs, prof: inner ? profileAt(i, j, g) : 0 })
  }
  // the stair approach: up to approachMax columns straight out from the tier-0 stair's OUTERMOST step (built only where the ground
  // falls away), on every stair face (v2 FACES 4: all four must be reachable)
  const appr = []
  for (const [i, j, f] of footSteps(face, g)) {
    const [di, dj] = { s: [0, 1], n: [0, -1], e: [1, 0], w: [-1, 0] }[f]
    for (let k = 1; k <= opts.approachMax; k++) {
      const x = corner.x + i + di * k, z = corner.z + j + dj * k
      if (avoid(x, z)) return { ok: false, why: 'avoid:approach' }
      const c = col(x, z)
      if (!c || c.why) return { ok: false, why: `approach_${c?.why ?? 'unread'}` }
      appr.push({ k, x, z, top: c.top, stair: [corner.x + i, corner.z + j] })
    }
  }
  const tops = base.map(c => c.top)
  let best = null
  for (let baseY = Math.min(...tops) + 1; baseY <= Math.max(...tops) + 1; baseY++) {
    let fill = 0, cut = 0, redo = 0
    for (const c of base) {
      if (c.top < baseY - 1) fill += edgeOf(c, g) ? baseY - 1 - c.top : Math.min(FOUND_DEPTH, baseY - 1 - c.top)
      if (c.top > baseY - 1 + c.prof) cut += c.top - (baseY - 1 + c.prof)
      for (const l of skin.get(`${c.i},${c.j}`) ?? []) if (baseY + l <= c.top) redo++
    }
    // the apron's walking level is the ground under layer 0 (feet at baseY): ground standing beside layer 0 would bury the outer
    // skin's face (offline 10-29: buried skin cells had no dig stand and stopped layer 0 `blocked`)
    for (const c of apron) if (c.top > baseY - 1) cut += c.top - (baseY - 1)
    // the stair's own step (layer 0, outside the base) needs ground at baseY-1; the approach steps go down one a column
    let approach = 0, ok = true
    // every step column needs ground at baseY-1 (fill under it); the approach goes out from the outermost step
    for (const [sx, sz] of stepCols(face, g).map(([i, j]) => [corner.x + i, corner.z + j])) {
      const s = apron.find(c => c.x === sx && c.z === sz)
      if (s && s.top < baseY - 1) fill += baseY - 1 - s.top
    }
    const stairCells = footSteps(face, g).map(([i, j]) => [corner.x + i, corner.z + j])
    for (const [sx, sz] of stairCells) {
      // the stair's top is feet baseY+1: a column k out is walkable onto the step before it when its ground is at baseY-k or
      // higher (feet baseY-k+1, a +1 climb); else a step block is set at y = baseY-k (on fill from the ground)
      let need = baseY - 1
      for (const a of appr.filter(a => a.stair[0] === sx && a.stair[1] === sz).sort((p, q) => p.k - q.k)) {
        if (a.top >= need) break                                         // walkable from here: a +1 step onto the last one
        if (a.k === opts.approachMax) { ok = false; break }
        approach += need - a.top; need -= 1
      }
    }
    if (!ok) continue
    const work = fill + approach + 2 * cut + 2 * redo
    if (!best || work < best.work) best = { baseY, fill: fill + approach, cut, redo, work }
  }
  if (!best) return { ok: false, why: 'approach_too_deep' }
  if (best.fill > opts.maxFillShare * plan) return { ok: false, why: 'fill' }
  if (best.cut > opts.maxCut) return { ok: false, why: 'cut' }
  const logs = base.reduce((t, c) => t + c.logs.length, 0) + apron.reduce((t, c) => t + c.logs.length, 0)
  return { ok: true, corner, centre, face, baseY: best.baseY, fill: best.fill, cut: best.cut, redo: best.redo, logs, work: best.work + logs, plan, base, apron, appr }
}

/**
 * THE RECORD for a site (buildproj.mjs publishRecord's payload; buildrun.mjs runVisit's input) -> record. Pure over `col` and
 * `read` (the blocks to clear are named from the world at siting: buildrun clears a cell only while it still holds that block).
 *   cells    the body (zigCells) + the foundation (`core`; `skin` under the base's outer ring, where it shows) and the stair's
 *            own fill and approach steps (`skin` / `stair`), all segment F
 *   clear    the CUT: natural ground above the finished profile in the base columns and above the walking level in the apron;
 *            logs standing over the body's columns above its top (their trunks would float over the terraces) -- kind 'tree'
 *            (no replant is owed: owner 10-26, a skipped replant is no obligation; the monument's felling is named as such);
 *            the canopy's leaves over the site -- kind 'leaves'
 */
export function zigRecord (site, read, { home, g = ZIG_DEFAULT, plan = null, sector = null, now = Date.now(), design = null } = {}) {
  const { corner, baseY, face } = site
  // v2 (zigdesign.mjs zigDesign): the design's palette, its dressed cells and its segments; v1: ZIG_PALETTE and the cells as before
  const palette = design?.palette ?? ZIG_PALETTE
  // AN AIR POCKET UNDER THE GROUND (offline on the showcase region 10-29: four core cells of layer 0 were air under natural dirt --
  // no face, no sight line, no stand: layer 0 never completed) is a hidden void, not a cell to place: a CORE cell at or below its
  // column's natural ground that is not solid is left out of the record. The skin is always built (the apron cut exposes it).
  const topAt = new Map(site.base.map(c => [`${c.x},${c.z}`, c.top]))
  // ...and LEAVES there count as the void they become (zig2 offline 10-30, seed 2716330262 on the showcase region: a core cell of
  // spruce leaves under natural dirt, over a hollow, was cleared by the canopy rule and then had no face and no stand -- 377 cells
  // waited on it: STALLED)
  const voidAt = b => !full(b) || /_leaves$/.test(nm(b))
  const body0 = zigCells({ corner, baseY, face }, g).filter(c => !(c.role === 'core' && c.at[1] <= (topAt.get(`${c.at[0]},${c.at[2]}`) ?? -Infinity) && voidAt(read(...c.at))))
  let found = []
  // the foundation under the base's OUTER ring shows below layer 0: skin (cobblestone), never a dirt skirt
  for (const c of site.base) {
    const edge = edgeOf(c, g)
    for (let y = edge ? c.top + 1 : Math.max(c.top + 1, baseY - FOUND_DEPTH); y < baseY; y++) found.push({ at: [c.x, y, c.z], role: edge ? 'skin' : 'core', seg: 'F', layer: -1 })
  }
  // under every step column of the tier-0 stair; the approach from the outermost step. v1 (H 2, one face): every step column is an
  // outermost one, so the cells and their order are exactly as before
  const stairCells = footSteps(face, g).map(([i, j]) => [corner.x + i, corner.z + j])
  const fillUnder = (sx, sz) => { const s = site.apron.find(c => c.x === sx && c.z === sz); if (s) for (let y = s.top + 1; y < baseY; y++) found.push({ at: [sx, y, sz], role: 'skin', seg: 'F', layer: -1 }) }
  const footKey = new Set(stairCells.map(([x, z]) => `${x},${z}`))
  for (const [sx, sz] of stepCols(face, g).map(([i, j]) => [corner.x + i, corner.z + j])) if (!footKey.has(`${sx},${sz}`)) fillUnder(sx, sz)
  for (const [sx, sz] of stairCells) {
    fillUnder(sx, sz)
    let need = baseY - 1
    for (const a of site.appr.filter(a => a.stair[0] === sx && a.stair[1] === sz).sort((p, q) => p.k - q.k)) {
      if (a.top >= need) break
      for (let y = a.top + 1; y <= need; y++) found.push({ at: [a.x, y, a.z], role: y === need ? 'stair' : 'skin', seg: 'F', layer: -1 })
      need -= 1
    }
  }
  // the design dresses the body (bands, trim, weathering; parapet, shrine, lights) and names the foundation's shown cells `plinth`
  let body = body0
  if (design) ({ body, found } = design.dress({ body: body0, found, corner, baseY, face, g }))
  const clear = []
  // the highest layer above baseY (v2: the shrine stands over the summit)
  const top = design ? Math.max(zigHeight(g), ...body.map(c => c.at[1] - baseY + 1)) : zigHeight(g)
  for (const c of site.base) {
    const ceil = baseY - 1 + c.prof
    for (let y = ceil + 1; y <= c.top; y++) { const b = read(c.x, y, c.z); if (b && full(b)) clear.push({ at: [c.x, y, c.z], kind: 'cut', name: nm(b) }) }
    for (const y of c.logs) if (y > ceil && y <= baseY + top + 12) clear.push({ at: [c.x, y, c.z], kind: LITTER.test(nm(read(c.x, y, c.z))) ? 'cut' : 'tree', name: nm(read(c.x, y, c.z)) })
  }
  for (const c of site.apron) {
    for (let y = baseY; y <= c.top; y++) { const b = read(c.x, y, c.z); if (b && full(b)) clear.push({ at: [c.x, y, c.z], kind: 'cut', name: nm(b) }) }
    for (const y of c.logs) if (y > baseY) clear.push({ at: [c.x, y, c.z], kind: LITTER.test(nm(read(c.x, y, c.z))) ? 'cut' : 'tree', name: nm(read(c.x, y, c.z)) })
  }
  // THE CANOPY (offline on the showcase's own region, 10-29: 1,227 leaves over the chosen site, 471 of them in record cells): every
  // leaves block in the site's columns (base and apron), from the ground to above the top -- RECORD CELLS INCLUDED. Else no
  // stand under a spruce canopy is a node of the walk (head room), and the offline run deadlocked: the foundation's hollow could not
  // be reached under leaves standing in layer 0's cells, which only layer 0's own visit (waiting on the foundation) would dig.
  // Most decay by themselves once their trunks are dug; a dig skips a cell that no longer holds the block named here.
  const lo = Math.min(...site.base.map(c => c.top), ...site.apron.map(c => c.top))
  // the base and its apron: the columns the site checked (no zone, no plan cell, no other project) -- Codex r1 note
  for (let x = corner.x - 1; x <= corner.x + g.B; x++) for (let z = corner.z - 1; z <= corner.z + g.B; z++) {
    for (let y = lo; y <= baseY + top + 3; y++) {
      const n = nm(read(x, y, z))
      if (/_leaves$/.test(n)) clear.push({ at: [x, y, z], kind: 'leaves', name: n })
    }
  }
  // GROUND IN A SKIN OR STAIR CELL (offline 10-29: dirt in the outer skin of layer 0 under grass in layer 1's skin had no dig stand
  // -- its only open face was too low to see past the cell above): listed with the cut, so the clears dig it, low first, a cell as
  // its face opens (the visit's foreign pass would reach it only in its own segment, under the cells above)
  // ...and EVERY LOG in a record cell, core included (offline 10-29: a spruce trunk in layer 1's skin covered the layer-0 cell under
  // it, which then had no stand; a trunk in the core is done as a solid but caps whatever is open below it): felled first, so the
  // canopy decays and the cells under it open
  for (const c of [...found, ...body]) {
    const b = read(...c.at), n = nm(b)
    if (b && /_log$|_wood$/.test(n)) { clear.push({ at: c.at, kind: 'tree', name: n }); continue }
    if (c.role === 'core') continue
    const ok = design ? (palette[c.role] ?? []).includes(n) : n === ZIG_PALETTE[c.role][0]
    if (b && full(b) && !ok && !TREE.test(n) && !FURNITURE.test(n)) clear.push({ at: c.at, kind: 'cut', name: n })
  }
  const cells = [...found, ...body]
  const bom = {}
  for (const c of cells) { const n = c.role === 'core' ? 'cobblestone' : palette[c.role][0]; bom[n] = (bom[n] ?? 0) + 1 }
  const v2 = design ? { palette, design: design.summary, topY: baseY + top - 1 } : {}
  return {
    v: 1, blueprint: design ? MONUMENT_BLUEPRINT_V2 : MONUMENT_BLUEPRINT, plot: MONUMENT_PLOT, home, sector, geometry: { ...g },
    corner: [corner.x, corner.z], centre: [site.centre.x, site.centre.z], face, baseY,
    box: [corner.x, corner.z, corner.x + g.B - 1, corner.z + g.B - 1],
    earthwork: { fill: site.fill, cut: site.cut, logs: site.logs },
    clear, replant: [], cells: cells.map(({ at, role, seg }) => ({ at, role, seg })),
    segments: design ? zigSegmentsOf(cells) : zigSegments(g, { foundation: found.length > 0 }), bom, builders_max: MONUMENT_BUILDERS,
    structure_complete: false, plan: plan ? { gen: plan.gen } : null, sitedAt: now, ...v2,
  }
}

/**
 * THE RESERVATION the town plan holds for the monument (ring@1's NW-preferred outer plot, townplan.mjs OUTER.monument) ->
 * [x0, z0, x1, z1] | null (no plan, or the plan left the monument unsited). Pure.
 */
export function monumentBox (plan) {
  const p = (plan?.plots ?? []).find(q => q.kind === 'monument')
  if (!p?.sector || !plan?.home) return null
  const [x0, , z0, x1, , z1] = sectorExtent(plan.home, plan.s ?? plan.home.y, 'monument', p.sector)
  return [x0, z0, x1, z1]
}
/**
 * WHAT A SITE MUST NOT MEET -> (x, z) -> reason | null. Pure. `column(x, z, y0, y1)` is buildsite.mjs reservations' (plan cells,
 * committed boxes, paths and soft keep-outs, wells, the farm); `zones` the protected boxes ([x0,y0,z0,x1,y1,z1]); `cells` other
 * projects' record cells ("x,z" columns), kept `pad` away (the workshop, a house).
 */
export function zigAvoid ({ column = () => null, zones = [], cells = new Set(), pad = SITE.avoidPad, y0 = 40, y1 = 140 } = {}) {
  return (x, z) => {
    const r = column(x, z, y0, y1)
    if (r) return r
    for (const zb of zones) { const b = zb.box ?? zb; if (x >= b[0] && x <= b[3] && z >= b[2] && z <= b[5]) return 'zone' }
    if (cells.size) for (let dx = -pad; dx <= pad; dx++) for (let dz = -pad; dz <= pad; dz++) if (cells.has(`${x + dx},${z + dz}`)) return 'project'
    return null
  }
}

/**
 * A SEALED CORE CELL (buildrun.mjs runVisit `alsoDone`; offline on the showcase region 10-29: an air cell of layer 0 between
 * natural ground and a spruce log -- the log is done core above it -- had no face and no stand, and layer 0 never completed): a
 * core cell whose six neighbours are all solid is hidden for good, so it counts as done. Pure over `read`.
 */
export function zigHidden (c, read) {
  if (c?.role !== 'core') return false
  const [x, y, z] = c.at
  for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
    const b = read(x + dx, y + dy, z + dz)
    if (!b || !full(b) || /_leaves$/.test(nm(b))) return false
  }
  return true
}
/**
 * The segments a builder may stand IN while building them (buildrun.mjs runVisit `feetIn`): EVERY one -- the foundation's
 * hollows, and each layer, built standing on the layer below (offline on the showcase region 10-29: with layer 1's cells as
 * obstacles, its outer ring had no stand where the ground fell away from the base -- the apron's eye was below the faces). The
 * open cells are never a floor. Pure.
 */
export const zigFeetIn = () => true
/**
 * THE FOUNDATION IN FOUR (live showcase 10-29 15:17-15:40Z: the foundation, 953 cells, was ONE segment -- one builder at a time,
 * every other visit `deps_open L00-N waits for F`, 167 placements in 23 min): a record's `F` cells split by the quadrant of their
 * column around the base's centre into F-N/F-E/F-S/F-W, each with no deps, and every segment that waited on F waits on all four.
 * The cells are unchanged (the record file, the tripwire's oracle, is not rewritten: the visit applies this in memory, and a record
 * already split is returned as it is). Pure.
 */
export function zigSplitFoundation (record) {
  if (!record?.cells?.some(c => c.seg === 'F')) return record
  const g = record.geometry ?? ZIG_DEFAULT
  const [cx0, cz0] = record.corner
  const F = ['N', 'E', 'S', 'W'].map(q => `F-${q}`)
  const cells = record.cells.map(c => (c.seg === 'F' ? { ...c, seg: `F-${quadrantOf(c.at[0] - cx0, c.at[2] - cz0, g)}` } : c))
  const used = F.filter(s => cells.some(c => c.seg === s))
  const segments = (record.segments ?? []).flatMap(s => (s.seg === 'F' ? used.map(seg => ({ seg, deps: [] })) : [{ ...s, deps: (s.deps ?? []).flatMap(d => (d === 'F' ? used : [d])) }]))
  return { ...record, cells, segments }
}
/**
 * WHAT A VISIT WANTS FROM TOWN BEFORE THE BAG -> { name: n }. Pure. `bill` the open cells' bill, `coreBill` the open CORE cells'
 * own; the bag's other core names (dirt, stone variants: `spare`) are credited against the core's cobblestone only -- the skin and
 * the stair take cobblestone alone (Codex r1 BLOCK: credited against the whole bill, 48 dirt cancelled one skin cell's cobblestone,
 * nothing was drawn and the visit stopped no_material every time).
 */
export function zigWant (bill = {}, coreBill = {}, spare = {}, palette = ZIG_PALETTE) {
  const other = (palette.core ?? []).filter(n => n !== '*solid' && n !== 'cobblestone').reduce((t, n) => t + (Number(spare[n]) || 0), 0)
  const out = { ...bill }
  if (out.cobblestone) out.cobblestone = Math.max(0, out.cobblestone - Math.min(other, Number(coreBill.cobblestone) || 0))
  return out
}
/** How many clear digs one visit tries before it turns to the segments (buildrun.mjs runVisit `clearMax`). */
export const ZIG_CLEAR_MAX = 60

/** Is a builder's feet ON the site (the record's box + 1, below its top + 2)? -> (feet) => bool, for runVisit's `leaveIf`. Pure. */
export function zigOnSite (record) {
  // v2: the record's topY (its shrine); v1: the body's height, as before
  const [x0, z0, x1, z1] = record.box, top = Number.isFinite(record.topY) ? record.topY + 3 : record.baseY + zigHeight(record.geometry ?? ZIG_DEFAULT) + 2
  return f => !!f && f[0] >= x0 - 1 && f[0] <= x1 + 1 && f[2] >= z0 - 1 && f[2] <= z1 + 1 && f[1] <= top
}

/** THE STANDS' DOMAIN for a monument visit (buildsite.mjs stepFor's `domain`): within the record's box + 6 and outside the
 *  town core (Chebyshev 8 of home: the builders never stand in the plaza to build). Pure. */
export function zigDomain (record, home) {
  const [x0, z0, x1, z1] = record.box
  return (x, z) => x >= x0 - 6 && x <= x1 + 6 && z >= z0 - 6 && z <= z1 + 6 && Math.max(Math.abs(x - home.x), Math.abs(z - home.z)) > 8
}
/** The walk's radius for a monument visit: far enough from home to reach every stand of the box + 6. Pure. */
export function zigWalkR (record, home) {
  const [x0, z0, x1, z1] = record.box
  return Math.max(48, ...[x0 - 7, x1 + 7].map(x => Math.abs(x - home.x)), ...[z0 - 7, z1 + 7].map(z => Math.abs(z - home.z)))
}
/** The record's progress -> { done, open, layer } from a `done(cell)` test: the lowest layer with an open cell. Pure. */
export function zigProgress (record, done) {
  let d = 0, open = 0, layer = null
  for (const c of record?.cells ?? []) {
    if (done(c)) { d++; continue }
    open++
    // F -1, D (v2's details, last) 99
    const l = c.seg.startsWith('F') ? -1 : c.seg.startsWith('D') ? 99 : Number(c.seg.slice(1, 3))
    if (layer == null || l < layer) layer = l
  }
  return { done: d, open, layer }
}

/**
 * THE TIDY (zigtidy-01, OWNER 10-30 via the showcase: dirt on the finished ziggurat's treads): the bots climb the tier walls on
 * pillars of dirt and cobblestone (scaffold.mjs `pillar_out`; one grand stair, walls H high), and the visit digs a foreign block
 * only out of an OPEN record cell -- a pillar stands on a finished tread, in a cell that is no record cell, and stays for good.
 * -> [{ at, kind: 'tidy', name }], highest first: every ZIG_TIDY block in the record's box + 1, above each column's highest record
 * cell (the apron's columns: from the base's level) up to the top + 2, that is neither a record cell nor listed in record.clear.
 * `skip(key)` drops a cell (the caller's bound on attempts). Pure over `read`; an unread cell is passed over.
 */
export const ZIG_TIDY = /^(dirt|coarse_dirt|rooted_dirt|grass_block|podzol|mycelium|cobblestone|cobbled_deepslate|stone|andesite|diorite|granite|tuff|deepslate|netherrack|gravel|sand|red_sand|sandstone|red_sandstone|dripstone_block|[a-z_]+_planks)$/
export const ZIG_TIDY_VISITS = 3
export function zigTidy (record, read, { skip = () => false } = {}) {
  if (!Array.isArray(record?.box) || !Array.isArray(record?.cells)) return []
  const cells = new Set(record.cells.map(c => c.at.join(',')))
  // a listed clear is the clears' own only while it still holds the block it was listed for (Codex zigtidy r1: a pillar standing
  // where leaves were listed and dug was nobody's)
  const listed = new Map((record.clear ?? []).map(c => [c.at.join(','), c.name]))
  const colTop = new Map()
  for (const c of record.cells) { const k = `${c.at[0]},${c.at[2]}`; colTop.set(k, Math.max(colTop.get(k) ?? -Infinity, c.at[1])) }
  const top = Number.isFinite(record.topY) ? record.topY : record.baseY + zigHeight(record.geometry ?? ZIG_DEFAULT) - 1
  const [x0, z0, x1, z1] = record.box
  const out = []
  for (let x = x0 - 1; x <= x1 + 1; x++) {
    for (let z = z0 - 1; z <= z1 + 1; z++) {
      const ct = colTop.get(`${x},${z}`)
      for (let y = ct != null ? ct + 1 : record.baseY; y <= top + 2; y++) {
        const k = `${x},${y},${z}`
        if (cells.has(k) || skip(k)) continue
        const b = read(x, y, z)
        if (listed.has(k) && listed.get(k) === nm(b)) continue
        if (b && ZIG_TIDY.test(nm(b))) out.push({ at: [x, y, z], kind: 'tidy', name: nm(b) })
      }
    }
  }
  return out.sort((a, b) => b.at[1] - a.at[1] || a.at[0] - b.at[0] || a.at[2] - b.at[2])
}
/**
 * THE TREAD TOPS (zigtidy-02): the cell above each column's highest record cell -> Map 'x,y,z' -> ZIG_TREAD_PRICE. A walk's scaffold
 * block there is the climbing pillar the tidy digs later (a 1x1 tower beside a tier wall puts its block at the feet, on the tread),
 * so shop.mjs footprintCost prices it (`soft`) and A* takes the grand stair unless it is far. Pure.
 */
export const ZIG_TREAD_PRICE = 60
export function zigTreadTops (record, price = ZIG_TREAD_PRICE) {
  const out = new Map()
  if (!Array.isArray(record?.cells)) return out
  const colTop = new Map()
  for (const c of record.cells) { const k = `${c.at[0]},${c.at[2]}`; colTop.set(k, Math.max(colTop.get(k) ?? -Infinity, c.at[1])) }
  for (const [k, y] of colTop) { const [x, z] = k.split(',').map(Number); out.set(`${x},${y + 1},${z}`, price) }
  return out
}
