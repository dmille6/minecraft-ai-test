// THE BUILDING TIER'S SITING PLANNER (shop-01 step 1; design docs/reports/building-tier-2026-10-23.md sections 4.1-4.3, 4.6).
// Pure over a `read(x, y, z)` and the town's FROZEN plan: no bot, no world writes, no files. The same function a bot will run at
// a build visit is run OFFLINE on region copies (bots/scripts/buildsite-offline.mjs), so where the workshop goes is known, and
// reviewed, before any actuator code exists. Run report: docs/reports/shop-01-siting-2026-10-25.md.
//
// WHAT IT DECIDES, IN ORDER (each refusal is named; the first one met is the candidate's reason):
//   1. the DOMAIN: every pad cell and every stand of the 1-cell ring around it at Chebyshev >= 22 and straight-line <= 44 from
//      home, in the workshop's sector (the plan's pavilion sector; D1: a free sector when the plan left the pavilion unsited);
//      the doorway faces home;
//   2. the PLAN and the RECORDS: no plan cell or stand (keepouts NEVER), a committed plot's box + 1 (BOX), an uncommitted
//      keep-out plot's box + 1 or a path segment (SOFT); no protected zone; no plinth well cell, cap or stair (and every column
//      in its prev[] history) within 3, nor a junk-well site; no tree-farm cell within 2; not the Z0 ziggurat footprint + 8 or
//      the M0 shaft origin + 8 (TP 2-8);
//   3. the FLOOR LEVEL (B4, D2): any full-cube solid is a floor (a gravity block only over another floor); per pad column a fill
//      of at most 3 down to one; the volume L+1 .. L+4 cleared (natural solids a CUT, at most 3 per column; other solids
//      scaffold LITTER; logs and leaves trees; bot furniture anywhere from the fill's floor up refuses); fill <= 40, cut <= 30,
//      litter <= 40; the least earthwork wins;
//   4. TREES: every log of a tree with a log in the fill span or the volume is in the plot's clear box (the footprint + 3), in no
//      reservation or zone, and within dig reach (5.0) of an eye on the pad; one trunk per tree (a 2x2 trunk refuses); a felled
//      trunk gets a LEGAL REPLANT CELL (soil, 7 air above, 8-24 from the pad, outside every reservation, beside a walkable cell)
//      reserved before anything is felled; a 1-log bush and floating logs owe none (D6);
//   5. THE PROOF: a construction sequence over the world after the clears -- the fill (`earth`) first, then the blueprint's
//      segments in order. A cell is placed only with a SUPPORT the builder would click (below or a side, never above, never a
//      block the click would open: builder.mjs refUsable), a STAND walked to from cells a bot STOOD on in town (D3: home's own
//      start cell, the feet cells bots logged within 16 of home -- at runtime the planning bot's own feet -- and the plan's
//      placed stations' recorded stands) with this segment's cells still to place as obstacles that are never floors, the face
//      within 4.5 of the eye, the eye on its open side, and a sight line every cell of which is known and empty (exact voxel
//      traversal, every cell an edge or corner crossing touches); then every open interior cell is walked to through the doorway.
//
// NOT PROVEN HERE (named; the actuator's and Paper's): the clear sequence itself (dig order; the reach rule above is the screen's),
// bodies, ghost blocks, the lease and barrier protocol, the room test with a lit light, whether a sapling grows where reserved.

import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { isSolid, isPassable, isLiquid, isTreeish, isFurniture, replaceableCell, sectorOf, keepouts, boxMeetsZones, cellInZones, rot } from './townplan.mjs'

const k3 = (x, y, z) => `${x},${y},${z}`
const k2 = (x, z) => `${x},${z}`
// a block's NAME without a state suffix (`oak_fence[waterlogged]` is an oak_fence: Codex siting r2 P2); liquid is townplan's isLiquid
const nm = b => String(b?.name ?? '').replace(/\[.*\]$/, '')

export const DOMAIN = Object.freeze({ cheb: 22, line: 44 })
export const EARTH = Object.freeze({ col: 3, fill: 40, cut: 30 })
export const LITTER_MAX = 40
export const REACH = 4.5
export const DIG_REACH = 5.0
export const EYE = 1.62
export const TREE = Object.freeze({ out: 3, maxLogs: 400 })
export const REPLANT = Object.freeze({ near: 8, far: 24, clear: 7 })
export const WALK_R = 48
export const TOWN_R = 16
export const PROOF_TRIES = 40

const SOIL = new Set(['grass_block', 'dirt', 'podzol', 'coarse_dirt', 'rooted_dirt'])
const LOG = /^(oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak)_(log|wood)$/
const LEAVES = /_leaves$/
const STEM = /(_stem|_hyphae|^mushroom_stem|_mushroom_block)$/
// bot furniture and fittings that refuse a site when they stand in its span (fitc.py's STATION list, plus the plan's FURNITURE)
const BUILT = /(chest|barrel|furnace|smoker|crafting_table|_bed$|lectern|composter|torch|lantern|ladder|_door$|_sign$|_hanging_sign$|rail$|_trapdoor$|_fence_gate$|hopper|anvil|bell|brewing_stand|_button$|lever|_pressure_plate$|campfire|_carpet$|_banner$|flower_pot)/
// a block the click would USE (it opens or toggles): never a support -- builder.mjs refUsable at eb407fa0, verbatim
const USES = /_trapdoor$|_door$|^chest$|^trapped_chest$|^barrel$|_shulker_box$|^crafting_table$|furnace$|^smoker$|^hopper$|^lectern$/
// a 'block' bounding box that is NOT a full cube a bot stands on as one step: fences and walls are 1.5 high, slabs and stairs
// are not one step, the rest are short or hollow (Codex siting r1 P2: a fence was walked as a floor)
const PARTIAL = /(_fence$|_wall$|_fence_gate$|_slab$|_stairs$|_carpet$|_pane$|^iron_bars$|^chain$|_trapdoor$|_bed$|^chest$|^trapped_chest$|^ender_chest$|^lantern$|^soul_lantern$|^ladder$|^flower_pot$|^potted_|^cocoa$|^chorus_plant$|^end_portal_frame$|^pitcher_crop$|^dried_ghast$|_hanging_sign$|^repeater$|^comparator$|^turtle_egg$|^sniffer_egg$|sculk_sensor$|^sculk_shrieker$|^frogspawn$|^lightning_rod$|^heavy_core$|^bell$|_head$|_skull$|^cake$|candle|^lectern$|^enchanting_table$|^stonecutter$|^daylight_detector$|^hopper$|anvil$|^brewing_stand$|^composter$|cauldron$|^snow$|^scaffolding$|_door$|^conduit$|_rod$|^grindstone$|campfire$|^bamboo$|^cactus$|^honey_block$|^dragon_egg$|_pressure_plate$|_button$|^sea_pickle$|_coral$|_coral_fan$|_coral_wall_fan$|^lily_pad$|^pointed_dripstone$|azalea$|_bud$|^amethyst_cluster$|^big_dripleaf$|^decorated_pot$|^pitcher_plant$)/
// a block that falls when a neighbour updates: a floor only over another floor
const GRAVITY = /^(sand|red_sand|gravel|suspicious_sand|suspicious_gravel|[a-z_]+_concrete_powder|anvil)$/
const SAPLING = { oak: 'oak_sapling', spruce: 'spruce_sapling', birch: 'birch_sapling', jungle: 'jungle_sapling', acacia: 'acacia_sapling', dark_oak: 'dark_oak_sapling', mangrove: 'mangrove_propagule', cherry: 'cherry_sapling', pale_oak: 'pale_oak_sapling' }
const NEEDS_2X2 = new Set(['dark_oak', 'pale_oak'])
// materials a bot places (scaffold, builds): never NATURAL, however they lie
const PLACED_MAT = /(_planks$|^cobblestone$|^mossy_cobblestone$|^stone_bricks$|^cobbled_deepslate$|glass|_wool$|_slab$|_stairs$|_wall$|_fence$|_concrete$|^bricks$|^smooth_stone$|copper|_bricks$|^stripped_)/
const AIR = Object.freeze({ name: 'air', boundingBox: 'empty' })
const SOLID = name => Object.freeze({ name, boundingBox: 'block' })
const ROLE_BOX = { light: 'empty' }

/** A full cube a bot stands on: a 'block' box that is not one of the PARTIAL shapes. Pure. */
export const fullCube = b => isSolid(b) && !PARTIAL.test(nm(b))
/** A NATURAL solid: a full cube that is not a tree, leaves, liquid, bot furniture or a placed material. Pure. */
export const naturalSolid = b => fullCube(b) && !isTreeish(b) && !LEAVES.test(nm(b)) && !isLiquid(b) && !BUILT.test(nm(b)) && !isFurniture(b) && !PLACED_MAT.test(nm(b))
/** A FLOOR for the pad: a full cube that is not a tree, leaves, liquid or bot furniture -- natural or placed (D2). Pure. */
export const solidFloor = b => fullCube(b) && !isTreeish(b) && !LEAVES.test(nm(b)) && !isLiquid(b) && !BUILT.test(nm(b)) && !isFurniture(b)
/** May a click use this block as its support? builder.mjs refUsable: solid, not a liquid, not a block the click would use. Pure. */
export const refUsable = b => isSolid(b) && !isLiquid(b) && !USES.test(nm(b))

/**
 * THE TOP SUPPORTED NATURAL GROUND of a column (a natural solid on a natural solid) within home.y +- 12 -> y; null if a read in
 * the span is unknown; undefined if there is none. Pure. Used for replant soil only: the pad's floor is levelFor's (D2).
 */
export function groundOf (read, x, z, hy) {
  for (let y = hy + 12; y >= hy - 12; y--) {
    const b = read(x, y, z)
    if (!b) return null
    if (!naturalSolid(b)) continue
    const below = read(x, y - 1, z)
    if (!below) return null
    if (naturalSolid(below)) return y
  }
  return undefined
}

const here = fileURLToPath(new URL('.', import.meta.url))
/** A blueprint by id ('workshop@1') from bots/src/blueprints/. */
export function loadBlueprint (id) { return JSON.parse(fs.readFileSync(`${here}blueprints/${id}.json`, 'utf8')) }

/** The cardinal unit vector a local direction (du, dv) points to under an orientation. */
const dirOf = (orient, du, dv) => { const { dx, dz } = rot(orient, du, dv); return [Math.sign(dx), Math.sign(dz)] }
/** The world cells of a blueprint at (anchor x, z, pad level s, orientation). Pure. */
export function placeBlueprint (bp, anchor, s, orient) {
  return bp.cells.map(c => { const { dx, dz } = rot(orient, c.u, c.v); return { ...c, at: [anchor.x + dx, s + c.y, anchor.z + dz] } })
}
/** Local (u, v) -> world (x, z). */
const at2 = (anchor, orient, u, v) => { const { dx, dz } = rot(orient, u, v); return [anchor.x + dx, anchor.z + dz] }

/** The footprint columns and the 1-cell stand ring of a candidate -> { pad: [[x,z]], ring: [[x,z]] }. Pure. */
export function footprint (bp, anchor, orient) {
  const pad = [], ring = []
  const W = bp.footprint.u, D = bp.footprint.v
  for (let u = -1; u <= W; u++) for (let v = -1; v <= D; v++) {
    const inside = u >= 0 && u < W && v >= 0 && v < D
    ;(inside ? pad : ring).push(at2(anchor, orient, u, v))
  }
  return { pad, ring }
}

/** Every column at Chebyshev >= 22 and straight-line <= 44 of home. Pure. */
export const inDomain = (home, x, z) => Math.max(Math.abs(x - home.x), Math.abs(z - home.z)) >= DOMAIN.cheb && Math.hypot(x - home.x, z - home.z) <= DOMAIN.line

/** Does the doorway face home? The front's outward normal must be the cardinal nearest the door -> home direction. Pure. */
export function facesHome (bp, home, anchor, orient) {
  const [nx, nz] = dirOf(orient, 0, -1)
  const [dx0, dz0] = at2(anchor, orient, bp.front.u, bp.front.v)
  const tx = home.x - dx0, tz = home.z - dz0
  const want = Math.abs(tx) >= Math.abs(tz) ? [Math.sign(tx), 0] : [0, Math.sign(tz)]
  return nx === want[0] && nz === want[1]
}

/**
 * THE RESERVATIONS a site must not meet -> { column(x, z, y0, y1) -> reason | null, zones }. Pure over the plan and the records.
 *   ctx.zones  [{ box: [x0,y0,z0,x1,y1,z1] }]  (protected zones + avoid boxes)
 *   ctx.wells  [[x, y, z]]  plinth well cells, caps and stairs (every record's plan and its prev[] history), junk-well sites
 *   ctx.farm   [[x, z]]     tree-farm record cells
 *   ctx.z0     { centre: {x, z} } | null   ctx.m0 { origin: {x, z} } | null
 */
export function reservations (plan, ctx = {}) {
  const ko = keepouts(plan)
  const wells = (ctx.wells ?? []).map(c => [c[0], c[2]])
  const farm = new Set((ctx.farm ?? []).map(([x, z]) => k2(x, z)))
  const z0 = ctx.z0?.centre ? [ctx.z0.centre.x - 24 - 8, ctx.z0.centre.z - 24 - 8, ctx.z0.centre.x + 24 + 8, ctx.z0.centre.z + 24 + 8] : null
  const m0 = ctx.m0?.origin ? [ctx.m0.origin.x - 8, ctx.m0.origin.z - 8, ctx.m0.origin.x + 8, ctx.m0.origin.z + 8] : null
  const inB = (b, x, z) => b && x >= b[0] && x <= b[2] && z >= b[1] && z <= b[3]
  const column = (x, z, y0, y1) => {
    for (let y = y0; y <= y1; y++) if (ko.never(x, y, z)) return 'plan_cell'
    if (ko.boxAt(x, z)) return 'plan_box'
    if (ko.softAt(x, z)) return 'plan_path_or_keepout'
    if (wells.some(([wx, wz]) => Math.max(Math.abs(wx - x), Math.abs(wz - z)) <= 3)) return 'well'
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) if (farm.has(k2(x + dx, z + dz))) return 'treefarm'
    if (inB(z0, x, z)) return 'z0_apron'
    if (inB(m0, x, z)) return 'm0_collar'
    return null
  }
  return { column, zones: ctx.zones ?? [] }
}

/** The connected logs of a tree from one log (26-neighbour, bounded) -> [[x, y, z]]. Pure. */
export function treeOf (read, start, max = TREE.maxLogs) {
  const seen = new Set([k3(...start)]), out = [start], q = [start]
  while (q.length && out.length <= max) {
    const [x, y, z] = q.shift()
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      if (!dx && !dy && !dz) continue
      const c = [x + dx, y + dy, z + dz], key = k3(...c)
      if (seen.has(key)) continue
      seen.add(key)
      if (LOG.test(nm(read(...c)))) { out.push(c); q.push(c) }
    }
  }
  return out
}
const speciesOf = name => (LOG.exec(name) ?? [])[1] ?? null

/**
 * ONE PAD COLUMN AT FLOOR LEVEL L (the pad at L + 1) -> { ok, why } | { ok, fill, plants, cut, litter, logs, leaves }. Pure.
 *   floor   the highest floor at or below L within EARTH.col (a gravity block only over another floor)
 *   fill    every cell from the floor up to L that is not a floor (at most EARTH.col); what stands there is cleared first
 *   cut     NATURAL full cubes in the volume L+1 .. L+4 (at most EARTH.col per column); litter: every other solid there
 *   refused a liquid in the fill span or L .. L+5, bot furniture ANYWHERE from the floor up to L+4 (Claude/Codex siting r1 P2:
 *           a chest under the pad was a `plant` clear), a mushroom, an unknown read
 */
export function columnAt (read, x, z, L) {
  const out = { ok: true, fill: [], plants: [], cut: [], litter: [], logs: [], leaves: [] }
  // a gravity block is a floor only when the chain under it ends on a floor that does not fall (Codex siting r2 P2)
  const floorAt = y => { for (let k = 0; k < 16; k++) { const b = read(x, y - k, z); if (!solidFloor(b)) return false; if (!GRAVITY.test(nm(b))) return true } return false }
  let f = L
  while (f >= L - EARTH.col) { if (!read(x, f, z)) return { ok: false, why: 'unknown' }; if (floorAt(f)) break; f-- }
  if (f < L - EARTH.col) return { ok: false, why: 'fill_too_deep' }
  const classify = (y, b, inVolume) => {
    const n = nm(b)
    if (isLiquid(b)) return { ok: false, why: 'liquid' }
    if (BUILT.test(n) || isFurniture(b)) return { ok: false, why: 'built_in_volume', detail: `${n}@${x},${y},${z}` }
    if (STEM.test(n)) return { ok: false, why: 'mushroom' }
    if (replaceableCell(b)) return null
    if (LOG.test(n)) { out.logs.push([x, y, z]); return null }
    if (LEAVES.test(n)) { out.leaves.push([x, y, z]); return null }
    if (!isSolid(b) || n === 'snow') { out.plants.push([x, y, z]); return null }
    if (inVolume && naturalSolid(b)) out.cut.push([x, y, z]); else out.litter.push([x, y, z])
    return null
  }
  for (let y = f + 1; y <= L; y++) {
    const b = read(x, y, z)
    if (!b) return { ok: false, why: 'unknown' }
    const bad = classify(y, b, false)
    if (bad) return bad
    out.fill.push([x, y, z])
  }
  for (let y = L + 1; y <= L + 5; y++) { const b = read(x, y, z); if (!b) return { ok: false, why: 'unknown' }; if (isLiquid(b)) return { ok: false, why: 'liquid' } }
  for (let y = L + 1; y <= L + 4; y++) { const bad = classify(y, read(x, y, z), true); if (bad) return bad }
  if (out.cut.length > EARTH.col) return { ok: false, why: 'cut_too_high' }
  return out
}

/**
 * THE PAD'S FLOOR LEVEL -> { ok, L, cols, cost } | { ok: false, why }. Pure. Every level home.y - 12 .. home.y + 12 where EVERY
 * pad column is feasible (columnAt) and the totals hold (fill <= 40, cut <= 30, litter <= 40); the least earthwork
 * (fill + cut + litter) wins, then the level nearest home's, then the lower. When none is feasible, the reason is the one AT THE
 * GROUND'S OWN LEVEL (the most common top floor of the pad's columns, ties lower); with no top floor at all, the level that got
 * furthest through the pad.
 */
export function levelFor (read, home, pad) {
  let best = null, why = null, mostCols = -1
  const at = new Map()
  for (let L = home.y - 12; L <= home.y + 12; L++) {
    const cols = []
    let bad = null
    for (const [x, z] of pad) { const c = columnAt(read, x, z, L); if (!c.ok) { bad = c; break } cols.push(c) }
    if (bad) { at.set(L, bad); if (cols.length > mostCols) { mostCols = cols.length; why = bad } continue }
    const fill = cols.reduce((n, c) => n + c.fill.length, 0), cut = cols.reduce((n, c) => n + c.cut.length, 0), litter = cols.reduce((n, c) => n + c.litter.length, 0)
    if (fill > EARTH.fill || cut > EARTH.cut || litter > LITTER_MAX) {
      const w = { why: litter > LITTER_MAX ? 'litter_over_40' : 'earthwork' }
      at.set(L, w)
      if (cols.length >= mostCols) { mostCols = cols.length; why = w }
      continue
    }
    const cost = fill + cut + litter
    if (!best || cost < best.cost || (cost === best.cost && Math.abs(L - home.y) < Math.abs(best.L - home.y))) best = { ok: true, L, cols, cost }
  }
  if (best) return best
  const g = topFloorLevel(read, home, pad)
  const w = (g != null && at.get(g)) || why
  return { ok: false, why: w?.why ?? 'no_level', detail: w?.detail }
}
/** The most common top floor of the pad's columns (the highest floor with no floor above it in home.y +- 12; ties lower). Pure. */
export function topFloorLevel (read, home, pad) {
  const n = new Map()
  for (const [x, z] of pad) {
    for (let y = home.y + 12; y >= home.y - 12; y--) {
      const b = read(x, y, z)
      if (!b) break
      if (solidFloor(b) && !solidFloor(read(x, y + 1, z))) { n.set(y, (n.get(y) ?? 0) + 1); break }
    }
  }
  if (!n.size) return null
  const top = Math.max(...n.values())
  return Math.min(...[...n].filter(([, c]) => c === top).map(([y]) => y))
}

/**
 * THE SCREEN of one candidate (sections 1-4 above) -> { ok, why, ...site }. Pure. `res` = reservations(plan, ctx).
 */
export function screenSite (read, home, bp, anchor, orient, res, { sector = null } = {}) {
  const { pad, ring } = footprint(bp, anchor, orient)
  const all = [...pad, ...ring]
  for (const [x, z] of all) if (!inDomain(home, x, z)) return { ok: false, why: 'domain' }
  if (sector) for (const [x, z] of all) if (sectorOf(home, x, z) !== sector) return { ok: false, why: 'sector' }
  if (!facesHome(bp, home, anchor, orient)) return { ok: false, why: 'door_not_toward_home' }
  // ---- the plan and the records over the whole span a level may take ----
  for (const [x, z] of all) { const why = res.column(x, z, home.y - 16, home.y + 17); if (why) return { ok: false, why } }
  const xs = all.map(c => c[0]), zs = all.map(c => c[1])
  if (boxMeetsZones([Math.min(...xs), home.y - 16, Math.min(...zs), Math.max(...xs), home.y + 20, Math.max(...zs)], res.zones)) return { ok: false, why: 'zone' }
  // ---- the floor level (B4, D2) ----
  const lv = levelFor(read, home, pad)
  if (!lv.ok) return { ok: false, why: lv.why, detail: lv.detail }
  const { L, cols } = lv
  const s = L + 1, g0 = L
  const fill = [], cut = [], clear = [], felled = new Map()
  const cleared = new Set()
  const addClear = (at, kind) => { const key = k3(...at); if (cleared.has(key)) return; cleared.add(key); clear.push({ at, kind, name: nm(read(...at)) }) }
  let litter = 0
  for (const c of cols) {
    fill.push(...c.fill)
    for (const at of c.plants) addClear(at, 'plant')
    for (const at of c.cut) { cut.push(at); addClear(at, 'cut') }
    for (const at of c.litter) { litter++; addClear(at, 'scaffold') }
    for (const at of c.leaves) addClear(at, 'leaves')
    for (const at of c.logs) {
      if ([...felled.values()].some(t => t.keys.has(k3(...at)))) continue
      const logs = treeOf(read, at)
      if (logs.length > TREE.maxLogs) return { ok: false, why: 'tree_too_big' }
      felled.set(k3(...at), { logs, keys: new Set(logs.map(q => k3(...q))) })
    }
  }
  for (const [x, z] of ring) for (let y = s - 1; y <= s + 2; y++) { const b = read(x, y, z); if (!b) return { ok: false, why: 'unknown' }; if (isLiquid(b)) return { ok: false, why: 'liquid' } }
  // ---- trees: the clear box, the reservations, dig reach from the pad, one trunk, the replant owed ----
  const bx0 = Math.min(...pad.map(c => c[0])) - TREE.out, bx1 = Math.max(...pad.map(c => c[0])) + TREE.out
  const bz0 = Math.min(...pad.map(c => c[1])) - TREE.out, bz1 = Math.max(...pad.map(c => c[1])) + TREE.out
  const eyes = pad.map(([x, z]) => [x + 0.5, s + 1 + EYE, z + 0.5])
  const reachable = ([x, y, z]) => eyes.some(e => Math.hypot(e[0] - (x + 0.5), e[1] - (y + 0.5), e[2] - (z + 0.5)) <= DIG_REACH)
  const trees = []
  for (const t of felled.values()) {
    for (const c of t.logs) {
      const [x, y, z] = c
      if (x < bx0 || x > bx1 || z < bz0 || z > bz1) return { ok: false, why: 'tree_beyond_plot' }
      if (res.column(x, z, y, y) || cellInZones(x, y, z, res.zones)) return { ok: false, why: 'tree_in_reservation' }
      if (!reachable(c)) return { ok: false, why: 'tree_out_of_reach' }
    }
    for (const c of t.logs) addClear(c, 'tree')
    // THE SAPLINGS OWED (r5, conservative by construction): EVERY log with neither a log nor leaves under it owes one -- a trunk on
    // the ground, a trunk whose ground was dug out (Claude r3 P2), a second trunk touching the first however it stands (Claude r2
    // P2, Codex r4 P2). A branch over air owes one too: an over-count costs saplings and replant cells, never a tree. Logs that
    // stand only on logs or leaves are floating and owe nothing. Only GROUNDED bases take part in the 2x2 test below
    const bases = t.logs.filter(([x, y, z]) => { const below = nm(read(x, y - 1, z)); return !LOG.test(below) && !LEAVES.test(below) })
    const grounded = bases.filter(([x, y, z]) => isSolid(read(x, y - 1, z)))
    // D6: FLOATING logs (no log stands on anything but logs or leaves) and a JUNGLE BUSH (one jungle log, the bush the jungle
    // generates under oak leaves: r4 requires the oak leaves, Codex r3 P2) owe no replant: no sapling of that kind replaces them.
    // Any other single log, a jungle one included, is the stump of a real tree and owes its sapling (Codex siting r2 P2)
    // a jungle BUSH is one jungle log CAPPED by oak leaves (the leaves directly on top: Codex r4 P2, a stump with a leaf beside it
    // is a stump)
    const bush = t.logs.length === 1 && speciesOf(nm(read(...t.logs[0]))) === 'jungle' && nm(read(t.logs[0][0], t.logs[0][1] + 1, t.logs[0][2])) === 'oak_leaves'
    if (!bases.length || bush) continue
    for (const b of bases) {
      const species = speciesOf(nm(read(...b)))
      // a 2x2 trunk -- a base with a CARDINAL neighbour base within 3 levels: a mega spruce, even staggered on a slope (Codex r3
      // P3) -- refuses, as a dark oak does: one sapling does not replace it. Two trees touching DIAGONALLY are two trunks.
      // Conservative: a branch or a fallen log lying on the ground beside its trunk refuses too
      if (NEEDS_2X2.has(species) || (grounded.includes(b) && grounded.some(o => o !== b && Math.abs(o[1] - b[1]) <= 3 && Math.abs(o[0] - b[0]) + Math.abs(o[2] - b[2]) === 1))) return { ok: false, why: 'tree_2x2' }
      trees.push({ base: b, species, logs: t.logs.length })
    }
  }
  if (litter > LITTER_MAX) return { ok: false, why: 'litter_over_40' }
  return { ok: true, why: 'ok', anchor, orient, s, g0, pad, ring, fill, cut, clear, litter, trees, felled: felled.size, sector }
}

// ---- the walk and the proof ----------------------------------------------------------------------------------------------

/** A read with an overlay map "x,y,z" -> block. */
export function overlay (read, over) { return (x, y, z) => over.get(k3(x, y, z)) ?? read(x, y, z) }

/**
 * WHERE A BOT CAN WALK FROM TOWN -> Set of feet keys. Pure. A node: a full-cube floor, feet and head passable, dry and known;
 * `block` cells are OBSTACLES that are never a floor (cells still to place: a stand may not rely on a block that is not there);
 * 4-neighbour steps of dy -1, 0, +1 with head room (symmetric: a reached stand walks back); inside Chebyshev `radius` of home.
 * THE SEEDS (D3, r4): cells a bot STOOD on -- home's own start cell (the nearest node within 2 of home), and every `stood` feet
 * cell inside the town circle that is a node here. Never "every plaza cell" (Codex r1 P2: a moat inside the plaza), never "beside
 * a chest" (Codex r2/r3 P2: a chest in a wall is opened from either side).
 */
export function walkFrom (read, home, block = new Set(), radius = WALK_R, { stood = [] } = {}) {
  const isNode = (x, y, z) => {
    if (block.has(k3(x, y, z)) || block.has(k3(x, y + 1, z)) || block.has(k3(x, y - 1, z))) return false
    const f = read(x, y - 1, z), a = read(x, y, z), h = read(x, y + 1, z)
    return !!f && !!a && !!h && fullCube(f) && isPassable(a) && isPassable(h) && !isLiquid(a) && !isLiquid(h)
  }
  // the walk's steps from one node -> its neighbours (4-neighbour, dy -1 / 0 / +1 with head room)
  const next = ([x, y, z], r) => {
    const out = []
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz
      if (Math.max(Math.abs(nx - home.x), Math.abs(nz - home.z)) > r) continue
      for (const dy of [0, 1, -1]) {
        const ny = y + dy
        if (dy === 1) { const hb = read(x, y + 2, z); if (!isPassable(hb) || block.has(k3(x, y + 2, z))) continue }
        if (dy === -1) { const hb = read(nx, y + 1, nz); if (!isPassable(hb) || block.has(k3(nx, y + 1, nz))) continue }
        if (!isNode(nx, ny, nz)) continue
        out.push([nx, ny, nz])
        break
      }
    }
    return out
  }
  // THE SEEDS (D3 r4): cells a bot STOOD on -- home's own start cell, and every `stood` feet cell inside the town circle
  // (Chebyshev TOWN_R) that is a node in this world. Never a cell merely NEAR something a bot used: a chest is opened from
  // either side of a wall, so "beside a chest" is evidence of neither side (Codex siting r2 and r3 P2: one, then two chests set
  // in a wall seeded its far side). At runtime the planning bot's own feet are a stood cell; offline, the positions the
  // pool's bots logged in town, and the stands found-01 recorded for its placed stations.
  const tagged = []
  outer: for (let r = 0; r <= 2; r++) {
    for (const dy of [0, 1, -1, 2, -2]) {
      for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue
        const c = [home.x + dx, home.y + dy, home.z + dz]
        if (isNode(...c)) { tagged.push([c]); break outer }
      }
    }
  }
  for (const c of stood) if (Array.isArray(c) && c.length === 3 && Math.max(Math.abs(c[0] - home.x), Math.abs(c[2] - home.z)) <= TOWN_R && isNode(...c)) tagged.push([c])
  // THE TOWN (r5): of the pieces the town circle's walkable cells fall into, only the one holding the MOST stood cells (ties: the
  // larger piece) -- a bot that dropped, swam or dug into a pit logs a position there, and a stand reached only from a pit does
  // not walk back to town (Claude siting r4 P2). The steps are symmetric, so every cell reached walks back to this piece.
  const comp = new Map(), size = []
  for (const [c] of tagged) {
    if (comp.has(k3(...c))) continue
    const id = size.length, q = [c]
    comp.set(k3(...c), id)
    for (let i = 0; i < q.length; i++) for (const n of next(q[i], TOWN_R)) { const key = k3(...n); if (!comp.has(key)) { comp.set(key, id); q.push(n) } }
    size.push(q.length)
  }
  // one vote per DISTINCT stood cell (a position logged a thousand times is one cell)
  const votes = new Map(), voted = new Set()
  for (const [c] of tagged) { const key = k3(...c); if (voted.has(key)) continue; voted.add(key); const id = comp.get(key); votes.set(id, (votes.get(id) ?? 0) + 1) }
  let town = -1
  for (const [id, v] of votes) if (town < 0 || v > votes.get(town) || (v === votes.get(town) && size[id] > size[town])) town = id
  const seen = new Set(), q = []
  for (const [c] of tagged) { const key = k3(...c); if (comp.get(key) === town && !seen.has(key)) { seen.add(key); q.push(c) } }
  for (let i = 0; i < q.length; i++) for (const n of next(q[i], radius)) { const key = k3(...n); if (!seen.has(key)) { seen.add(key); q.push(n) } }
  return seen
}

/**
 * IS THE SEGMENT eye -> point OPEN? Exact voxel traversal (Amanatides-Woo) from the eye's cell to the point; every cell entered
 * before the point is known and has an empty box, except `through` (the target). Stricter than any sampling: a cell the ray
 * crosses is always entered (Codex siting r1 P2: 0.1 sampling stepped over a melon and a grass block). Pure.
 */
export function sightClear (read, eye, pt, through = new Set()) {
  const d = [pt[0] - eye[0], pt[1] - eye[1], pt[2] - eye[2]]
  const cell = [Math.floor(eye[0]), Math.floor(eye[1]), Math.floor(eye[2])]
  const step = d.map(v => Math.sign(v))
  const tMax = [0, 1, 2].map(i => d[i] === 0 ? Infinity : (step[i] > 0 ? cell[i] + 1 - eye[i] : eye[i] - cell[i]) / Math.abs(d[i]))
  const tDelta = [0, 1, 2].map(i => d[i] === 0 ? Infinity : 1 / Math.abs(d[i]))
  const open = c => { if (through.has(k3(...c))) return true; const b = read(...c); return !!b && b.boundingBox === 'empty' }
  for (let guard = 0; guard < 96; guard++) {
    const tmin = Math.min(...tMax)
    if (tmin >= 1 - 1e-9) return true
    const tied = [0, 1, 2].filter(i => tMax[i] - tmin <= 1e-9)
    // AN EDGE OR CORNER CROSSING (Codex siting r2 P2: hive-d order 49): every cell the ray touches there is checked, since the
    // builder's 0.05 sampling can land in any of them
    if (tied.length > 1) {
      for (const i of tied) { const c = cell.slice(); c[i] += step[i]; if (!open(c)) return false }
      if (tied.length === 3) for (const [i, j] of [[0, 1], [0, 2], [1, 2]]) { const c = cell.slice(); c[i] += step[i]; c[j] += step[j]; if (!open(c)) return false }
    }
    for (const i of tied) { cell[i] += step[i]; tMax[i] += tDelta[i] }
    if (!open(cell)) return false
  }
  return false
}

// the builder's support order: the block BELOW first, then the four sides; never the face above (builder.mjs supportsFor)
const SUPPORTS = [[0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]
/**
 * ONE STEP for a cell -> { stand, support, face } | null. Pure. `nodes` = walkable feet cells by column ("x,z" -> [y]).
 * A support is a block the builder would click (refUsable) below or beside the cell; the face is its face toward the cell; the
 * eye (feet + 1.62, centred) is within REACH of the face centre, on its open side, with a clear sight line; the stand is not the
 * cell (feet or head) and is in the build domain. Nearest wins.
 */
export function stepFor (read, home, cell, nodes) {
  const [cx, cy, cz] = cell
  let best = null, bd = Infinity
  for (const [fx, fy, fz] of SUPPORTS) {
    const sup = [cx + fx, cy + fy, cz + fz]
    if (!refUsable(read(...sup))) continue
    const normal = [0 - fx, 0 - fy, 0 - fz]   // never -0 (a record compares and serialises cleanly)
    const fc = [sup[0] + 0.5 + normal[0] * 0.5, sup[1] + 0.5 + normal[1] * 0.5, sup[2] + 0.5 + normal[2] * 0.5]
    for (let dx = -5; dx <= 5; dx++) for (let dz = -5; dz <= 5; dz++) {
      const sx = cx + dx, sz = cz + dz
      const ys = nodes.get(k2(sx, sz))
      if (!ys || !inDomain(home, sx, sz)) continue
      for (const sy of ys) {
        if (sx === cx && sz === cz && (sy === cy || sy + 1 === cy)) continue
        const eye = [sx + 0.5, sy + EYE, sz + 0.5]
        const v = [eye[0] - fc[0], eye[1] - fc[1], eye[2] - fc[2]]
        const d = Math.hypot(...v)
        if (d > REACH || d >= bd) continue
        if (v[0] * normal[0] + v[1] * normal[1] + v[2] * normal[2] <= 0) continue
        if (!sightClear(read, eye, fc, new Set([k3(cx, cy, cz)]))) continue
        best = { stand: [sx, sy, sz], support: sup, face: normal }; bd = d
      }
    }
  }
  return best
}

const byColumn = keys => {
  const m = new Map()
  for (const key of keys) { const [x, y, z] = key.split(',').map(Number); const c = k2(x, z); if (!m.has(c)) m.set(c, []); m.get(c).push(y) }
  return m
}
const blockFor = (bp, role) => { if (role === 'fill') return 'cobblestone'; const first = (bp.palette[role] ?? ['stone'])[0]; return first.startsWith('$') ? 'oak_planks' : first }

/**
 * THE PROOF of a screened site (section 5 above) -> { ok, why, cells, segments, interior }. Pure.
 * The world is the read with the clears applied (air). The FILL is proven as its own first segment `earth` (cobblestone, from
 * the bottom up), then the blueprint's segments in order. `stood` = the walk's seeds, cells a bot stood on (D3).
 */
export function proveSite (read, home, bp, site, { stood = [] } = {}) {
  const over = new Map()
  for (const c of site.clear) over.set(k3(...c.at), AIR)
  const R = overlay(read, over)
  const earth = site.fill.map(at => ({ at, role: 'fill', seg: 'earth', u: 0, v: 0, y: -1 }))
  const cells = [...earth, ...placeBlueprint(bp, site.anchor, site.s, site.orient)]
  for (const c of cells) {
    const b = R(...c.at)
    if (!b) return { ok: false, why: 'unknown' }
    if (!(replaceableCell(b) || b === AIR)) return { ok: false, why: 'cell_not_free', detail: `${nm(b)}@${c.at.join(',')}` }
  }
  const out = [], segOut = []
  let order = 0
  const segments = [...(earth.length ? [{ seg: 'earth', layer: -1, deps: [] }] : []), ...bp.segments.map(s => (s.seg === 'pad' && earth.length ? { ...s, deps: ['earth'] } : s))]
  for (const sg of segments) {
    // the cells STILL TO PLACE in this segment are obstacles and never floors; every placed cell (earlier segments, and this
    // one's so far) is in the overlay: a wall, and a floor. The walk is recomputed only when no cell has a step and something
    // was placed since the last walk (a builder walks onto the pad it has laid); with nothing new, the cell is no_step.
    const mine = cells.filter(c => c.seg === sg.seg)
    const left = mine.slice().sort((a, b) => a.at[1] - b.at[1] || a.u - b.u || a.v - b.v)
    const walkNow = () => byColumn(walkFrom(R, home, new Set(left.filter(c => (ROLE_BOX[c.role] ?? 'block') === 'block').map(c => k3(...c.at))), WALK_R, { stood }))
    let nodes = walkNow(), fresh = true, walks = 1
    while (left.length) {
      let pick = -1, step = null
      for (let i = 0; i < left.length; i++) {
        step = stepFor(R, home, left[i].at, nodes)
        if (step) { pick = i; break }
      }
      if (pick < 0 && !fresh) { nodes = walkNow(); fresh = true; walks++; continue }
      if (pick < 0) return { ok: false, why: 'no_step', detail: `${sg.seg} ${left.length} left, first ${left[0].role}@${left[0].at.join(',')}`, segments: segOut }
      fresh = false
      const c = left.splice(pick, 1)[0]
      over.set(k3(...c.at), Object.freeze({ name: blockFor(bp, c.role), boundingBox: ROLE_BOX[c.role] ?? 'block' }))
      out.push({ at: c.at, role: c.role, seg: c.seg, stand: step.stand, support: step.support, face: step.face, order: order++ })
    }
    segOut.push({ seg: sg.seg, layer: sg.layer, deps: sg.deps, cells: mine.length, walks, stands: new Set(out.filter(o => o.seg === sg.seg).map(o => k3(...o.stand))).size })
  }
  // the finished building: EVERY open interior floor cell is walked to from town through the open doorway
  const final = walkFrom(R, home, new Set(), WALK_R, { stood })
  const solidInside = new Set(cells.filter(c => (ROLE_BOX[c.role] ?? 'block') === 'block').map(c => k3(...c.at)))
  const interior = bp.interior.filter(([, , y]) => y === 1).map(([u, v]) => { const { dx, dz } = rot(site.orient, u, v); return k3(site.anchor.x + dx, site.s + 1, site.anchor.z + dz) })
  const open = interior.filter(k => !solidInside.has(k))
  const inside = open.filter(k => final.has(k)).length
  if (!open.length || inside < open.length) return { ok: false, why: 'interior_unreachable', detail: `${inside}/${open.length}`, segments: segOut }
  return { ok: true, why: 'ok', cells: out, segments: segOut, interior: { cells: interior.length, open: open.length, reachable: inside } }
}

/**
 * ONE REPLANT CELL at column (x, z) -> [x, y, z] | null. Pure. The planner's AND the visit's rule (Paper 10-25 SHOP-TERRAIN
 * hive-c, twice: the planner accepted a cell by a loose "a walk node beside it" test, the visit's stepFor found no stand placing
 * onto the soil below, and every visit stopped no_step before anything was placed): soil ground, REPLANT.clear air above, no
 * reservation or zone, and a STEP the visit accepts -- stepFor with its support the soil block under the cell.
 */
export function replantCellAt (read, home, x, z, res, nodes) {
  const g = groundOf(read, x, z, home.y)
  if (g == null || !SOIL.has(nm(read(x, g, z)))) return null
  for (let y = g + 1; y <= g + REPLANT.clear; y++) { const b = read(x, y, z); if (!b || nm(b) !== 'air') return null }
  if (res?.column?.(x, z, g, g + 1) || boxMeetsZones([x, g, z, x, g + 1, z], res?.zones ?? [])) return null
  const step = stepFor(read, home, [x, g + 1, z], nodes)
  return step && step.support[1] === g ? [x, g + 1, z] : null
}
/** The replant band around a pad (REPLANT.near .. far, never the footprint) -> [[d, x, z]], nearest first. Pure. */
function replantBand (padXZ, footprint) {
  const xs = padXZ.map(c => c[0]), zs = padXZ.map(c => c[1])
  const bx0 = Math.min(...xs), bx1 = Math.max(...xs), bz0 = Math.min(...zs), bz1 = Math.max(...zs)
  const cand = []
  for (let x = bx0 - REPLANT.far; x <= bx1 + REPLANT.far; x++) for (let z = bz0 - REPLANT.far; z <= bz1 + REPLANT.far; z++) {
    const d = Math.max(bx0 - x, x - bx1, bz0 - z, z - bz1, 0)
    if (d < REPLANT.near || d > REPLANT.far || footprint.has(k2(x, z))) continue
    cand.push([d, x, z])
  }
  return cand.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2])
}
/** Replant cells for the felled trunks -> { ok, cells: [{ cell, species, sapling, state }] }. Pure. */
export function replantFor (read, home, site, res, walk) {
  if (!site.trees.length) return { ok: true, cells: [] }
  const footprint = new Set([...site.pad, ...site.ring].map(([x, z]) => k2(x, z)))
  const cand = replantBand(site.pad, footprint)
  const nodes = byColumn(walk)
  const used = new Set(), out = []
  for (const t of site.trees) {
    let got = null
    for (const [, x, z] of cand) {
      if (used.has(k2(x, z))) continue
      const cell = replantCellAt(read, home, x, z, res, nodes)
      if (!cell) continue
      got = { cell, species: t.species, sapling: SAPLING[t.species], state: 'pending' }
      break
    }
    if (!got) return { ok: false, cells: out }
    used.add(k2(got.cell[0], got.cell[2])); out.push(got)
  }
  return { ok: true, cells: out }
}
/**
 * THE VISIT'S REMEDY for a replant cell it cannot reach now (the world changed since siting) -> [x, y, z] | null: the nearest
 * other cell of the same band around the RECORD's pad that replantCellAt accepts from here, never a record cell's column nor
 * another replant's. Pure. null: no cell in the band can be planted from here (the caller records the replant SKIPPED).
 */
export function replantAlternative (read, home, record, nodes, res = null, exclude = []) {
  const pad = (record?.cells ?? []).filter(c => c.seg === 'pad').map(c => [c.at[0], c.at[2]])
  if (!pad.length) return null
  const footprint = new Set((record.cells ?? []).map(c => k2(c.at[0], c.at[2])))
  // never another replant's column, nor a cell this replant has already been refused at (r19, Codex r18 P2: A -> B -> A)
  const taken = new Set([...(record.replant ?? []).filter(r => r.state !== 'skipped').map(r => k2(r.cell[0], r.cell[2])),
    ...exclude.map(c => k2(c[0], c[2]))])
  const seen = new Set()
  const tryAt = (x, z) => { const k = k2(x, z); if (seen.has(k) || taken.has(k) || footprint.has(k)) return null; seen.add(k); return replantCellAt(read, home, x, z, res, nodes) }
  for (const [, x, z] of replantBand(pad, footprint)) { const c = tryAt(x, z); if (c) return c }
  // THEN THE WHOLE TOWN WALK (r19, Claude r18 P2-1: design S2 -- never a felled tree without its sapling while ANY legal cell
  // exists): every walked column, nearest the pad first
  // ... keeping the band's own clearance from the building (r20, Codex r19 P2: a sapling beside the walls grows into the stand
  // ring the construction proof walks): never nearer the pad than REPLANT.near
  const xs = pad.map(c => c[0]), zs = pad.map(c => c[1])
  const bx0 = Math.min(...xs), bx1 = Math.max(...xs), bz0 = Math.min(...zs), bz1 = Math.max(...zs)
  const cx = (bx0 + bx1) / 2, cz = (bz0 + bz1) / 2
  const cols = [...nodes.keys()].map(k => k.split(',').map(Number))
    .filter(([x, z]) => Math.max(bx0 - x, x - bx1, bz0 - z, z - bz1, 0) >= REPLANT.near)
    .sort((a, b) => Math.hypot(a[0] - cx, a[1] - cz) - Math.hypot(b[0] - cx, b[1] - cz))
  for (const [x, z] of cols) { const c = tryAt(x, z); if (c) return c }
  return null
}

/** The bill of a proven cell list by palette role (the first choice; fallbacks are the record's). Pure. */
export function billOf (bp, cells) {
  const out = {}
  for (const c of cells) { const b = c.role === 'fill' ? 'cobblestone' : (bp.palette[c.role] ?? ['?'])[0]; out[b] = (out[b] ?? 0) + 1 }
  return out
}

const ORIENTS = ['E', 'S', 'W', 'N']
// ring@1's order for the outer plots that take what is left (townplan.mjs assignOuter: the cardinals, then the diagonals)
const REST_ORDER = ['S', 'W', 'N', 'E', 'NE', 'SE', 'SW', 'NW']
/**
 * THE SECTORS THE WORKSHOP MAY TAKE, in order -> [{ sector, source }]. Pure. The pavilion's when the plan sited it (design
 * 4.3: the workshop replaces the pavilion as the first roofed build). DEVIATION D1 (named for review): when the plan left the
 * pavilion UNSITED -- its 35-wide extent met a zone, or no sector was free for it (7 of 16 frozen plans, 10-25) -- every
 * sector no other outer plot holds (well, farm, gate, shaft, monument, hall), in ring@1's order. The workshop's own 11 x 9
 * footprint still faces every zone and reservation test cell by cell.
 */
export function workshopSectors (plan) {
  const plots = plan?.plots ?? []
  const pav = plots.find(p => p.kind === 'pavilion')
  if (pav?.sector) return [{ sector: pav.sector, source: 'pavilion' }]
  const taken = new Set(plots.filter(p => p.kind !== 'pavilion' && p.sector).map(p => p.sector))
  return REST_ORDER.filter(s => !taken.has(s)).map(s => ({ sector: s, source: 'free' }))
}
/**
 * THE SECTORS A LATER PROJECT MAY TAKE (house-01), in order -> [{ sector, source }]. Pure. The first project's sector first
 * (`first`: the workshop record's -- the houses stand beside it), then every sector no other outer plot holds, in ring@1's
 * order (workshopSectors' free list), once each.
 */
export function projectSectors (plan, first = null) {
  const out = []
  const seen = new Set()
  const push = (sector, source) => { if (sector && !seen.has(sector)) { seen.add(sector); out.push({ sector, source }) } }
  push(first, 'beside')
  const pav = (plan?.plots ?? []).find(p => p.kind === 'pavilion')
  if (pav?.sector) push(pav.sector, 'pavilion')
  const taken = new Set((plan?.plots ?? []).filter(p => p.kind !== 'pavilion' && p.sector).map(p => p.sector))
  for (const s of REST_ORDER) if (!taken.has(s)) push(s, 'free')
  return out
}
/** A plinth record's columns -> [[x, y, z]]: the plan's steps, cap and stair, and every prev[] column {x, y, z, stair} (plinth.mjs carryPrev). */
export function plinthCells (rec) {
  const out = []
  const pl = rec?.plan
  if (pl && typeof pl === 'object') {
    for (const st of pl.steps ?? []) if (Array.isArray(st?.c)) out.push(st.c)
    if (pl.cap) out.push([pl.cap.x, pl.cap.y, pl.cap.z])
    for (const c of pl.stair ?? []) if (Array.isArray(c) && c.length === 3) out.push(c)
  }
  for (const c of Array.isArray(rec?.prev) ? rec.prev : []) {
    if (!c || !Number.isFinite(c.x) || !Number.isFinite(c.y) || !Number.isFinite(c.z)) continue
    out.push([c.x, c.y, c.z])
    for (const s of Array.isArray(c.stair) ? c.stair : []) if (Array.isArray(s) && s.length === 3) out.push(s)
  }
  return out
}

/** The plan's stood cells: the stand found-01 recorded for every PLACED plan cell (a bot stood there to place it). Pure. */
export function planTownCells (plan) {
  const out = []
  for (const p of plan?.plots ?? []) for (const c of [...(p.cells ?? []), ...(p.stations ?? [])]) if ((c.state === 'placed') && Array.isArray(c.stand)) out.push(c.stand)
  return out
}

/**
 * SITE A BLUEPRINT FOR A TOWN -> { ok, why, record | null, sectors: [{ sector, source, screened, tried, rejects, proofFails }] }.
 * Pure. Per sector in workshopSectors order: screen every anchor and orientation, sort the survivors (least earthwork, fewest
 * trees, nearest), prove at most `tries` (PROOF_TRIES); the first proven site with its replant cells wins.
 *   plan  the town plan's head (frozen)
 *   ctx   { zones, wells, farm, z0, m0 } (reservations); { stood } feet cells bots stood on in town (the walk's seeds, D3); { tries }
 */
export function siteBlueprint (read, plan, bp, ctx = {}) {
  const home = plan?.home
  if (!home) return { ok: false, why: 'no_plan', sectors: [] }
  // house-01: a caller may name the sectors (a house: the workshop's sector first, then the free ones); else the workshop's
  const secs = Array.isArray(ctx.sectors) ? ctx.sectors : workshopSectors(plan)
  if (!secs.length) return { ok: false, why: 'no_free_sector', sectors: [] }
  const res = reservations(plan, ctx)
  const stood = [...(ctx.stood ?? []), ...planTownCells(plan)]
  const out = []
  for (const { sector, source } of secs) {
    const rejects = {}, ok = []
    for (const orient of ORIENTS) {
      for (let x = home.x - DOMAIN.line; x <= home.x + DOMAIN.line; x++) {
        for (let z = home.z - DOMAIN.line; z <= home.z + DOMAIN.line; z++) {
          const r = screenSite(read, home, bp, { x, z }, orient, res, { sector })
          if (r.ok) ok.push(r); else rejects[r.why] = (rejects[r.why] ?? 0) + 1
        }
      }
    }
    const dist = r => Math.hypot(r.pad[0][0] - home.x, r.pad[0][1] - home.z)
    ok.sort((a, b) => (a.fill.length + a.cut.length + a.litter) - (b.fill.length + b.cut.length + b.litter) || a.trees.length - b.trees.length || dist(a) - dist(b))
    const proofFails = {}
    const tries = Math.min(ok.length, ctx.tries ?? PROOF_TRIES)
    const row = { sector, source, screened: ok.length, tried: 0, rejects, proofFails }
    out.push(row)
    for (let i = 0; i < tries; i++) {
      const site = ok[i]
      row.tried = i + 1
      const p = proveSite(read, home, bp, site, { stood })
      if (!p.ok) { proofFails[p.why] = (proofFails[p.why] ?? 0) + 1; continue }
      const over = new Map()
      for (const c of site.clear) over.set(k3(...c.at), AIR)
      for (const c of site.fill) over.set(k3(...c), SOLID('cobblestone'))
      const rp = replantFor(read, home, site, res, walkFrom(overlay(read, over), home, new Set(), WALK_R, { stood }))
      if (!rp.ok) { proofFails.no_replant_cell = (proofFails.no_replant_cell ?? 0) + 1; continue }
      const xs = site.pad.map(c => c[0]), zs = site.pad.map(c => c[1])
      const record = {
        v: 1, blueprint: bp.id, plot: ctx.plot ?? 'shop', home, sector, sector_source: source, orient: site.orient, anchor: [site.anchor.x, site.anchor.z],
        box: [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)], s: site.s, floor: site.g0,
        earthwork: { fill: site.fill.length, cut: site.cut.length, litter: site.litter },
        fill: site.fill, clear: site.clear.map(c => ({ at: c.at, kind: c.kind, name: c.name })),
        trees: site.trees.map(t => ({ base: t.base, species: t.species, logs: t.logs })), felled: site.felled, replant: rp.cells,
        cells: p.cells, segments: p.segments, interior: p.interior, bom: billOf(bp, p.cells), builders_max: 2,
        structure_complete: false, plan: { gen: plan.gen }, stood_seeds: stood.length,
      }
      return { ok: true, why: 'ok', record, sectors: out }
    }
  }
  const any = out.some(r => r.screened)
  return { ok: false, why: any ? 'no_proven_site' : 'no_site', record: null, sectors: out }
}
