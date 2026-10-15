// THE ZIGGURAT (docs/reports/ziggurat-mineshaft-2026-10-15.md, OWNER 10-15: solid, by layers). PURE: geometry, the
// frozen plan and the site scan. Nothing here touches a bot; the offline siting gate (scripts/zigsite.mjs, Z0) and,
// later, the monument job run the SAME functions, so the site the bots build on is the site the gate approved.
//
// SHAPE: a B x B base (48), square tiers H high (2), stepping in S per side (3): sides 48, 42, ..., 6 -> 8 tiers, 16
// high. Every cell rests on the cell below (solid by layers): skin = the 26-adjacent exposed shell, core = the rest.
// The grand stair: one full block per tier at the foot of each tier wall on the face toward home, 3 wide.
// Every drop on the finished structure is <= H = 2, so it needs no guard.
import { solid, isLiquid } from './blueprint.mjs'

export const ZIG = Object.freeze({ B: 48, S: 3, H: 2, STAIR_W: 3, APRON: 2 })
/** The apron's nearest cell keeps this Chebyshev distance from home (plinth 21, town floor box 16 + 8 read margin). */
export const SITE_MIN_APRON = 25
/** The centre keeps within this Chebyshev distance of home (time near home). */
export const SITE_MAX_CENTRE = 64
/** Reject a site whose foundation fill exceeds this share of the plan. */
export const MAX_FOUNDATION_SHARE = 0.30
export const VOID_DEPTH = 20

/** Tier sides for a geometry. Pure. */
export function tierSides ({ B, S } = ZIG) {
  const out = []
  for (let L = B; L >= 2 * S && L > 0; L -= 2 * S) out.push(L)
  return out
}

/** Layers of solid structure above base at column offset (i, j) from the NW corner (0..B-1). Pure. */
export function profileAt (i, j, g = ZIG) {
  const sides = tierSides(g)
  let layers = 0
  for (let t = 0; t < sides.length; t++) {
    const o = t * g.S
    if (i >= o && i < g.B - o && j >= o && j < g.B - o) layers = (t + 1) * g.H
  }
  return layers
}

/**
 * THE FROZEN PLAN -> [{x,y,z,layer,tier,role}] in build order: layer by layer from the bottom, centre outward within a
 * layer. corner = the NW corner {x, z}; baseY = the y of layer 0. stairFace: 'n'|'s'|'w'|'e' (the face toward home).
 */
export function zigCells ({ corner, baseY, stairFace = 's' }, g = ZIG) {
  const solidSet = new Set(), cells = []
  const k = (i, l, j) => `${i},${l},${j}`
  const sides = tierSides(g), top = sides.length * g.H
  for (let i = 0; i < g.B; i++) for (let j = 0; j < g.B; j++) { const p = profileAt(i, j, g); for (let l = 0; l < p; l++) solidSet.add(k(i, l, j)) }
  const exposed = (i, l, j) => {
    for (let di = -1; di <= 1; di++) for (let dl = -1; dl <= 1; dl++) for (let dj = -1; dj <= 1; dj++) {
      if (!di && !dl && !dj) continue
      if (l + dl < 0) continue
      if (!solidSet.has(k(i + di, l + dl, j + dj))) return true
    }
    return false
  }
  const c = (g.B - 1) / 2
  // the grand stair: a 1-high step at the foot of every tier wall (tier t >= 1 stands on tier t-1's terrace; tier 0 on the
  // apron) on stairFace, STAIR_W wide, centred. A step is at tier t's first layer, so it is placed WITH that layer (Codex
  // stage-1 P3: appended after the whole body, the plan was not ordered by layer).
  const stairs = new Map()
  const w0 = Math.floor((g.B - g.STAIR_W) / 2)
  for (let t = 0; t < sides.length; t++) {
    const o = t * g.S, l = t * g.H
    for (let w = 0; w < g.STAIR_W; w++) {
      const along = w0 + w
      const pos = { s: [along, g.B - o], n: [along, o - 1], e: [g.B - o, along], w: [o - 1, along] }[stairFace]
      if (!stairs.has(l)) stairs.set(l, [])
      stairs.get(l).push({ x: corner.x + pos[0], y: baseY + l, z: corner.z + pos[1], layer: l, tier: t, role: 'stair' })
    }
  }
  for (let l = 0; l < top; l++) {
    const layer = []
    for (let i = 0; i < g.B; i++) for (let j = 0; j < g.B; j++) {
      if (!solidSet.has(k(i, l, j))) continue
      layer.push({ x: corner.x + i, y: baseY + l, z: corner.z + j, layer: l, tier: Math.floor(l / g.H), role: exposed(i, l, j) ? 'skin' : 'core', i, j })
    }
    layer.sort((a, b) => Math.max(Math.abs(a.i - c), Math.abs(a.j - c)) - Math.max(Math.abs(b.i - c), Math.abs(b.j - c)) || a.i - b.i || a.j - b.j)
    for (const cell of layer) { delete cell.i; delete cell.j; cells.push(cell) }
    for (const st of stairs.get(l) ?? []) cells.push(st)
  }
  return cells
}

const VEG = /^(short_grass|tall_grass|fern|large_fern|dead_bush|dandelion|poppy|.*_tulip|azure_bluet|oxeye_daisy|cornflower|lily_of_the_valley|allium|blue_orchid|sunflower|lilac|rose_bush|peony|snow|sweet_berry_bush|bush|firefly_bush|leaf_litter|wildflowers|pink_petals|.*_mushroom|vine|glow_lichen|moss_carpet|short_dry_grass|tall_dry_grass|cactus_flower|seagrass|tall_seagrass|kelp|kelp_plant|lily_pad)$/
const TREE = /(_log|_wood|_leaves|^mangrove_roots|^bamboo|^cactus|^sugar_cane|^cocoa|_mushroom_block|^mushroom_stem)$/   // huge mushrooms are trees (Claude stage-1 P3)
const SAPLING = /(_sapling|^mangrove_propagule)$/
/** Town furniture and anything a site must never be built over: a REFUSAL, never cleared. */
export const FURNITURE = /(chest|barrel|blast_furnace|_bed$|composter|lectern|trapdoor|_door$|_sign$|smoker|anvil|hopper|stonecutter|^rail$|_rail$|bell|brewing_stand|enchanting_table|jukebox|note_block|loom|cartography_table|fletching_table|smithing_table|grindstone|campfire|spawner)/
/** Bot litter (pillars, scaffolds, torches, dropped placements): CLEARED by the job (it returns to its bag). */
// crafting tables and furnaces OUTSIDE the town are the bots' field litter (measured 10-15 near board-a: 47 tables, 28
// furnaces in the siting ring) -- picked up by the job; town furniture is never in the ring (apron >= 25 from home).
export const DEBRIS = /(^crafting_table$|^furnace$|^cobblestone$|^cobbled_deepslate$|_planks$|_slab$|_stairs$|^torch$|_torch$|^wall_torch$|lantern|ladder|fence|_wall$|glass|stone_bricks|smooth_stone|^andesite$|^diorite$|^granite$|^tuff$|^dirt$|^gravel$|^sand$)/
const NATURAL_GROUND = b => solid(b) && !TREE.test(b.name) && !FURNITURE.test(b.name)

/**
 * ONE COLUMN -> { top, above: [{y, kind}], what }. top = the y of the highest natural solid ground block below every
 * tree, sapling, furniture, liquid and air gap reached from above: a dirt/cobble PILLAR on the ground is litter above
 * the ground, not the ground (a run of DEBRIS directly on top of natural ground is classed by its block: andesite,
 * dirt, gravel and sand standing ALONE above air are litter; the same blocks continuous with the ground are ground).
 * above lists what stands above top up to yHi (kind: tree | sapling | furniture | debris | water | lava); what counts
 * voids (air within VOID_DEPTH below top) and liquidBelow (an aquifer under the site: reported, never a refusal).
 */
export function scanColumn (read, x, z, { yHi, yLo } = {}) {
  const what = { voids: 0, unknown: 0, liquidBelow: 0 }
  const above = []
  let top = null
  for (let y = yHi; y >= yLo; y--) {
    const b = read(x, y, z)
    if (!b) { what.unknown++; continue }
    if (b.name === 'air' || b.name === 'cave_air' || b.name === 'void_air' || VEG.test(b.name)) continue
    if (b.name === 'bee_nest' || b.name === 'beehive') { above.push({ y, kind: 'bees', name: b.name }); continue }   // its own refusal, not 'furniture' (Claude stage-1 P3)
    if (isLiquid(b)) { above.push({ y, kind: /lava/.test(b.name) ? 'lava' : 'water' }); continue }
    if (SAPLING.test(b.name)) { above.push({ y, kind: 'sapling' }); continue }
    if (TREE.test(b.name)) { above.push({ y, kind: 'tree' }); continue }
    if (FURNITURE.test(b.name)) { above.push({ y, kind: 'furniture', name: b.name }); continue }
    if (DEBRIS.test(b.name) && !/^(dirt|gravel|sand|andesite|diorite|granite|tuff)$/.test(b.name)) { above.push({ y, kind: 'debris' }); continue }
    if (NATURAL_GROUND(b) || DEBRIS.test(b.name)) {
      // A NATURAL-LOOKING BLOCK IS GROUND ONLY IF IT IS PART OF TERRAIN: solid below AND at least 2 of its 4 horizontal
      // neighbours solid at the same height. A 1x1 dirt or andesite pillar (Codex stage-1 P2: an 11-high dirt pillar read
      // as ground at 80) and a 1-wide bridge are litter standing above the ground.
      const u = read(x, y - 1, z)
      let side = 0
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nb = read(x + dx, y, z + dz); if (nb && solid(nb) && !TREE.test(nb.name)) side++ }
      if (u && solid(u) && side >= 2) { top = y; break }
      above.push({ y, kind: 'debris' }); continue
    }
    above.push({ y, kind: 'debris' })
  }
  if (top != null) {
    for (let y = top - 1; y >= top - VOID_DEPTH; y--) {
      const b = read(x, y, z)
      if (b && (b.name === 'air' || b.name === 'cave_air' || b.name === 'void_air')) what.voids++
      if (b && isLiquid(b)) what.liquidBelow++
    }
  }
  return { top, above, what }
}

/** Chebyshev distance between {x,z}s. */
export const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z))

/** The face toward home for a site centre. Pure. */
export function faceToward (centre, home) {
  const dx = home.x - centre.x, dz = home.z - centre.z
  return Math.abs(dx) >= Math.abs(dz) ? (dx > 0 ? 'e' : 'w') : (dz > 0 ? 's' : 'n')
}

/** Water columns a site may fill as foundation (placing into water replaces it); more is a refusal. */
export const MAX_WATER_COLUMNS = 24
/** Natural ground above the finished profile the job may level (dig) on a chosen site: 0 = never dig terrain. */
export const MAX_CUT = 0
/**
 * SCORE ONE SITE over a precomputed column map col(x,z) -> scanColumn result. -> { ok, why, baseY, foundation, apronFill,
 * cut, clear, waterCols, ... }. REFUSALS: an unread column, any lava, any furniture, more than MAX_WATER_COLUMNS water
 * columns, an `avoid` overlap, natural ground ABOVE the finished profile (cut: the monument never digs terrain), a
 * foundation share above MAX_FOUNDATION_SHARE. COSTS: foundation (fill from ground to baseY-1, water included), apron fill,
 * clear = trees, saplings and litter inside the volume or within 2 above it (felled / picked up by the job: wood and
 * cobble to its bag). baseY minimises foundation + apronFill + 2 x clear + 50 x cut.
 */
/** The drop off the apron's outer edge kept at most this (a berm is filled outside where the ground falls away more). */
export const MAX_EDGE_DROP = 3
/** The stair approach may sit at most this far below the apron (filled up to a +1 step); deeper refuses the base height. */
export const APPROACH_MAX = 4
/** Is ring cell (i, j) (offsets from the NW corner, one outside the apron) in front of the grand stair? Pure. */
export function inApproach (i, j, face, g = ZIG) {
  const A = g.APRON, w0 = Math.floor((g.B - g.STAIR_W) / 2), w1 = w0 + g.STAIR_W - 1
  if (face === 's') return j === g.B + A && i >= w0 && i <= w1
  if (face === 'n') return j === -A - 1 && i >= w0 && i <= w1
  if (face === 'e') return i === g.B + A && j >= w0 && j <= w1
  if (face === 'w') return i === -A - 1 && j >= w0 && j <= w1
  return false
}
export function scoreSite ({ col, corner, g = ZIG, avoid = [], maxWater = MAX_WATER_COLUMNS, maxCut = MAX_CUT, stairFace = null }) {
  const B = g.B, A = g.APRON
  const tally = { lava: 0, furniture: 0, bees: 0, waterCols: 0, voids: 0, liquidBelow: 0, nocol: 0, unknown: 0 }
  const cx = corner.x + B / 2, cz = corner.z + B / 2
  for (const a of avoid) if (Math.max(Math.abs(a.x - cx), Math.abs(a.z - cz)) <= B / 2 + A + (a.r ?? 0)) return { ok: false, why: `overlaps ${a.what}`, tally }
  const cols = [], ring = []
  for (let i = -A - 1; i < B + A + 1; i++) for (let j = -A - 1; j < B + A + 1; j++) {
    const c = col(corner.x + i, corner.z + j)
    const outer = i === -A - 1 || j === -A - 1 || i === B + A || j === B + A
    if (outer) {
      // THE RING: only its ground height matters for a guarded edge -- but the stair APPROACH cells are built on (filled to a
      // +1 step), so they get the footprint's checks: read completeness, lava, furniture, bees, and their clearance and water
      // (Codex stage-1 r3 P2: a chest or lava in an approach cell passed).
      if (!c || c.top == null) { tally.nocol++; continue }
      const appr = !!stairFace && inApproach(i, j, stairFace, g)
      if (appr) {
        tally.unknown += c.what.unknown
        if (c.above.some(a => a.kind === 'lava')) tally.lava++
        if (c.above.some(a => a.kind === 'furniture')) tally.furniture++
        if (c.above.some(a => a.kind === 'bees')) tally.bees++
        if (c.above.some(a => a.kind === 'water')) tally.waterCols++   // the approach is built on: its water counts toward the limit (Codex r4)
      }
      ring.push({ i, j, top: c.top, appr, above: appr ? c.above : [] })
      continue
    }
    if (!c || c.top == null) { tally.nocol++; continue }
    const inner = i >= 0 && i < B && j >= 0 && j < B
    tally.unknown += c.what.unknown
    if (c.above.some(a => a.kind === 'lava')) tally.lava++
    if (c.above.some(a => a.kind === 'furniture')) tally.furniture++
    if (c.above.some(a => a.kind === 'bees')) tally.bees++
    if (c.above.some(a => a.kind === 'water')) tally.waterCols++
    if (inner) { tally.voids += c.what.voids; tally.liquidBelow += c.what.liquidBelow }
    cols.push({ i, j, inner, prof: inner ? profileAt(i, j, g) : 0, top: c.top, above: c.above })
  }
  // A PARTIAL READ IS NOT A READ (Codex stage-1 P2): any unread cell in the scanned band refuses, as an unread column does.
  if (tally.nocol) return { ok: false, why: `${tally.nocol} columns unread`, tally }
  if (tally.unknown) return { ok: false, why: `${tally.unknown} cells unread`, tally }
  if (tally.lava) return { ok: false, why: `lava in ${tally.lava} columns`, tally }
  if (tally.furniture) return { ok: false, why: `town furniture in ${tally.furniture} columns`, tally }
  if (tally.bees) return { ok: false, why: `a bee nest in ${tally.bees} columns`, tally }
  if (tally.waterCols > maxWater) return { ok: false, why: `water in ${tally.waterCols} columns`, tally }
  const ys = cols.map(t => t.top)
  const apronAt = new Map(cols.filter(t => !t.inner).map(t => [`${t.i},${t.j}`, t]))
  // THE PLANNED STAIR CELLS (relative i, j, layer): water already in one is replaced by that step's own placement (Codex
  // stage-1 r3: stair water was counted twice)
  const stairRel = stairRelFor(stairFace, g)
  let best = null, bestFeasible = null
  for (let baseY = Math.min(...ys) + 1; baseY <= Math.max(...ys) + 1; baseY++) {
    let foundation = 0, cut = 0, apronFill = 0, clear = 0, waterFill = 0, berm = 0, maxDrop = 0   // berm = guard wall + approach fill
    for (const t of cols) {
      // THE APRON SURFACE IS EXACTLY baseY-1 (feet at baseY), so the grand stair's first step is +1 from it (Claude stage-1
      // P1: an apron left at baseY-2 put the first step at +2, which the pathfinder cannot climb). Ground at baseY is
      // accepted (it holds the cell the stair step occupies); anything higher is cut.
      const ceil = t.inner ? baseY - 1 + t.prof : baseY
      if (t.inner) {
        if (t.top < baseY - 1) foundation += baseY - 1 - t.top
        if (t.top > ceil) cut += t.top - ceil
      } else {
        if (t.top < baseY - 1) apronFill += baseY - 1 - t.top
        if (t.top > baseY) cut += t.top - baseY
      }
      for (const a of t.above) {
        if (a.kind === 'water') {
          // EVERY ACCEPTED WATER CELL IS ACCOUNTED FOR (Codex stage-1 P2): below the fill line it is already counted in the
          // foundation/apron fill (fill runs from the ground up); above it, it is replaced by a placement -- waterFill.
          // ...and a water cell INSIDE a planned cell is replaced by that cell's own placement, already in the plan (Codex
          // stage-1 r2: it was counted twice); only water above the finished column is extra.
          if (stairRel.has(`${t.i},${t.j},${a.y - baseY}`)) continue   // a planned stair step replaces it
          if (t.inner ? a.y > ceil : a.y > baseY - 1) waterFill++   // the apron has no planned cell above its surface
        } else if (a.y <= ceil + 2) clear++
      }
    }
    // THE EDGE (Claude stage-1 P2: drops off the apron of up to 20 were unmeasured). The apron surface (baseY-1) meets the
    // ground just outside it. Where that ground is more than MAX_EDGE_DROP lower, a 2-high GUARD wall stands on the apron's
    // outer cell (bots walk the apron inside it); no drop off the site a bot can walk to then exceeds 3. The stair's
    // approach (the ring cells in front of the stair) is never walled: there the ground must be within +1 of the apron
    // (a step up) -- a lower approach is filled up to baseY-2, and an approach more than APPROACH_MAX below refuses the height.
    let approachBad = false
    for (const r of ring) {
      // the drop from the apron cell inside this ring cell: its surface is max(its ground, baseY-1) (Claude stage-1 r2 P3: an
      // apron cell left with ground at baseY stood 4 above the outside unguarded)
      const ii = Math.min(Math.max(r.i, -A), g.B + A - 1), jj = Math.min(Math.max(r.j, -A), g.B + A - 1)
      const inside = apronAt.get(`${ii},${jj}`)
      const surf = Math.max(inside?.top ?? baseY - 1, baseY - 1)
      const drop = surf - r.top
      if (r.appr) {
        if (drop > APPROACH_MAX) approachBad = true
        else if (drop > 1) berm += drop - 1
        for (const a of r.above) {
          // water INSIDE the approach fill is replaced by that fill (Codex r4: it was counted twice); only water above it is extra
          if (a.kind === 'water') { if (a.y > (drop > 1 ? surf - 1 : r.top)) waterFill++ }   // the fill reaches surf-1 (a +1 step to the apron)
          else if (a.y <= baseY) clear++
        }
      } else if (drop > MAX_EDGE_DROP) { berm += 2; maxDrop = Math.max(maxDrop, drop) }
    }
    if (approachBad) continue
    const fill = foundation + apronFill + waterFill + berm
    const score = fill + 2 * clear + 50 * cut + 0.2 * tally.voids + 0.05 * tally.liquidBelow
    const cand = { baseY, foundation, apronFill, waterFill, guardAndApproach: berm, maxEdgeDropGuarded: maxDrop, cut, clear, score }
    if (!best || score < best.score) best = cand
    // FEASIBLE FIRST (Codex stage-1 P2): minimise cost among heights within the levelling budget and the foundation share.
    if (cut <= maxCut && (!bestFeasible || score < bestFeasible.score)) {
      const share = fill / planSize(g)
      if (share <= MAX_FOUNDATION_SHARE) bestFeasible = { ...cand, share }
    }
  }
  if (bestFeasible) return { ok: true, why: 'ok', ...bestFeasible, plan: planSize(g), tally }
  if (!best) return { ok: false, why: 'no base height gives the stair an approach', tally }
  const share = (best.foundation + best.apronFill + best.waterFill + best.guardAndApproach) / planSize(g)
  return { ok: false, why: best.cut > maxCut ? `${best.cut} solid cells above the profile (levelling digs over ${maxCut})` : `fill ${Math.round(share * 100)}% of the plan`, ...best, share, plan: planSize(g), tally }
}
const stairRels = new Map()
/** The planned stair cells as relative 'i,j,layer' keys for a face (memoised: scoreSite runs per candidate). */
export function stairRelFor (face, g = ZIG) {
  if (!face) return new Set()
  const k = face + JSON.stringify(g)
  if (!stairRels.has(k)) stairRels.set(k, new Set(zigCells({ corner: { x: 0, z: 0 }, baseY: 0, stairFace: face }, g).filter(c => c.role === 'stair').map(c => `${c.x},${c.z},${c.y}`)))
  return stairRels.get(k)
}
const planSizes = new Map()
/** The plan's cell count (body + stair) for a geometry. */
export function planSize (g = ZIG) {
  const k = JSON.stringify(g)
  if (!planSizes.has(k)) planSizes.set(k, zigCells({ corner: { x: 0, z: 0 }, baseY: 0 }, g).length)
  return planSizes.get(k)
}

/** Natural ground (kept in place as done-degraded core): not a tree, not furniture, not litter-only material. Pure. */
export const keptGround = b => !!b && solid(b) && !TREE.test(b.name) && !FURNITURE.test(b.name) && !/^(cobblestone|cobbled_deepslate|crafting_table|furnace)$|_planks$|_slab$|_stairs$|glass|stone_bricks|smooth_stone/.test(b.name)

/** Candidate NW corners whose centre lies in the siting ring. Pure. */
export function candidateCorners (home, { step = 2, g = ZIG, maxCentre = SITE_MAX_CENTRE } = {}) {
  const out = [], half = g.B / 2, reach = half + g.APRON
  for (let dx = -maxCentre; dx <= maxCentre; dx += step) for (let dz = -maxCentre; dz <= maxCentre; dz += step) {
    const d = Math.max(Math.abs(dx), Math.abs(dz))
    if (d - reach < SITE_MIN_APRON) continue
    out.push({ x: home.x + dx - half, z: home.z + dz - half, centre: { x: home.x + dx, z: home.z + dz } })
  }
  return out
}
