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
import { worldState, orientAim, slabMerges } from './townstyle.mjs'
import { isCottage2Blueprint, cottage2Blueprint, lookOf } from './cottage2.mjs'   // cottage2-01: the generated cottage family
import { isCivicBlueprint, civicBlueprint } from './civic.mjs'   // civic-01: the landmarks' generated blueprints

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
// cottage2-01: a BED is used, never a support (Paper 11-08: a bed clicked beside a placed bed was a sleep, 8 of 8 clicks; nothing placed)
const USES = /_trapdoor$|_door$|^chest$|^trapped_chest$|^barrel$|_shulker_box$|^crafting_table$|furnace$|^smoker$|^hopper$|^lectern$|_bed$/
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
const ROLE_BOX = { light: 'empty', flower: 'empty' }   // cottage2-01: a window box's flower is walked through

/** reroof-04: a slab whose TOP face is a full block's (type top or double: its props from the reader) -> bool. Unread props: false. Pure. */
export const slabTopFloor = b => !!b && /_slab$/.test(nm(b)) && ['top', 'double', 'bottom'].includes(String(b.props?.type ?? ''))
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
// civic-01: a landmark's blueprint is GENERATED from its id (civic.mjs civicBlueprint: one per seeded look), never a file
export function loadBlueprint (id) {
  // cottage2-01: the cottage@2 family is GENERATED per look (cottage2.mjs), never a file
  if (isCottage2Blueprint(id)) return cottage2Blueprint(lookOf(id))
  if (isCivicBlueprint(id)) return civicBlueprint(id)
  return JSON.parse(fs.readFileSync(`${here}blueprints/${id}.json`, 'utf8'))
}

/** The cardinal unit vector a local direction (du, dv) points to under an orientation. */
const dirOf = (orient, du, dv) => { const { dx, dz } = rot(orient, du, dv); return [Math.sign(dx), Math.sign(dz)] }
/** The world cells of a blueprint at (anchor x, z, pad level s, orientation). Pure. */
export function placeBlueprint (bp, anchor, s, orient) {
  // townstyle-01: a cell with a LOCAL state (`st`) carries its WORLD state (`ws`) for this orientation (townstyle.mjs worldState)
  return bp.cells.map(c => { const { dx, dz } = rot(orient, c.u, c.v); const ws = worldState(c.st, orient); return { ...c, at: [anchor.x + dx, s + c.y, anchor.z + dz], ...(ws ? { ws } : {}) } })
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
 *   ctx.z0     { centre: {x, z} } | { box: [x0, z0, x1, z1] } (a sited ziggurat's record box: monument-01) | null
 *   ctx.m0     { origin: {x, z} } | null
 */
export function reservations (plan, ctx = {}) {
  const ko = keepouts(plan)
  const wells = (ctx.wells ?? []).map(c => [c[0], c[2]])
  const farm = new Set((ctx.farm ?? []).map(([x, z]) => k2(x, z)))
  const zb = Array.isArray(ctx.z0?.box) && ctx.z0.box.length === 4 && ctx.z0.box.every(Number.isFinite) ? ctx.z0.box : null
  const z0 = zb ? [zb[0] - 8, zb[1] - 8, zb[2] + 8, zb[3] + 8]
    : ctx.z0?.centre ? [ctx.z0.centre.x - 24 - 8, ctx.z0.centre.z - 24 - 8, ctx.z0.centre.x + 24 + 8, ctx.z0.centre.z + 24 + 8] : null
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

/**
 * leaffell-01show r1 (Codex r1 BLOCKER): IS A TRUNK'S LOG IN A RESERVATION? -> 'leaf_tree_reserved' | null. Pure. The screen's own tree
 * rule (`tree_in_reservation`: a plan cell, box or path, a well, the tree farm's columns, the monument's apron -- reservations(); a
 * protected zone or an avoid box -- its zones), asked of a tree that is felled only so the leaves it holds decay. ONE rule for the
 * styled sitings (siteBlueprintSteps) and the retrofit (trunkGuard: skills.mjs reroofLeafCtx): the retrofit asked only the protected
 * zones, so a tree of the separately recorded tree farm that held a roof leaf would have been felled and replanted elsewhere.
 */
export const trunkReserved = (res, [x, y, z]) => (res.column(x, z, y, y) || cellInZones(x, y, z, res.zones ?? []) ? 'leaf_tree_reserved' : null)
/** THE TRUNK GUARD of a fell-first plan (leaffell.mjs leafFellPlan `closed`) -> (x, y, z) -> reason | null: `trunk_closed` in a protected
 *  zone (`zoneClosed`), `leaf_tree_reserved` in a reservation (trunkReserved), `reservations_unread` when the town's reservations could
 *  not be read (`res` null: nothing is felled on a guess). Pure. */
export const trunkGuard = (res, zoneClosed = null, unread = 'reservations_unread') => (x, y, z) => (zoneClosed?.(x, y, z) ? 'trunk_closed' : !res ? String(unread || 'reservations_unread') : trunkReserved(res, [x, y, z]))
/**
 * leaffell-01show r2 (Codex r2 BLOCKER): THE RESERVATIONS A TRUNK GUARD MAY TRUST -> { res, why: null } | { res: null, why }. Pure.
 * reservations() over inputs that each SAY whether they were read: the siting's own readers answer "none" for a record that is absent
 * AND for one that exists and cannot be read (skills.mjs treeFarmCells: an unparseable farm record is an empty farm), so the guard
 * built on them let a tree of an unreadable tree farm be felled. `inputs` = { zonesKnown, zones, farm: { ok, why, cells: [[x, z]] },
 * wells: { ok, why, cells: [[x, y, z]] }, z0: { ok, why, z0 } }; an input that is not `ok` (or missing) names the refusal: nothing is
 * felled on a guess. A record that is ABSENT is ok and empty.
 */
export function reservationsStrict (plan, { zonesKnown = false, zones = [], farm = null, wells = null, z0 = null } = {}) {
  if (!plan) return { res: null, why: 'plan_unread' }
  if (!zonesKnown) return { res: null, why: 'zones_unknown' }
  for (const [name, inp] of [['treefarm', farm], ['wells', wells], ['monument', z0]]) if (!inp?.ok) return { res: null, why: String(inp?.why ?? `${name}_unread`) }
  return { res: reservations(plan, { zones, wells: wells.cells ?? [], farm: farm.cells ?? [], z0: z0.z0 ?? null }), why: null }
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
export function columnAt (read, x, z, L, earth = EARTH) {
  const out = { ok: true, fill: [], plants: [], cut: [], litter: [], logs: [], leaves: [] }
  // a gravity block is a floor only when the chain under it ends on a floor that does not fall (Codex siting r2 P2)
  const floorAt = y => { for (let k = 0; k < 16; k++) { const b = read(x, y - k, z); if (!solidFloor(b)) return false; if (!GRAVITY.test(nm(b))) return true } return false }
  let f = L
  while (f >= L - earth.col) { if (!read(x, f, z)) return { ok: false, why: 'unknown' }; if (floorAt(f)) break; f-- }
  if (f < L - earth.col) return { ok: false, why: 'fill_too_deep' }
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
  if (out.cut.length > earth.col) return { ok: false, why: 'cut_too_high' }
  return out
}

/**
 * THE PAD'S FLOOR LEVEL -> { ok, L, cols, cost } | { ok: false, why }. Pure. Every level home.y - 12 .. home.y + 12 where EVERY
 * pad column is feasible (columnAt) and the totals hold (fill <= 40, cut <= 30, litter <= 40); the least earthwork
 * (fill + cut + litter) wins, then the level nearest home's, then the lower. When none is feasible, the reason is the one AT THE
 * GROUND'S OWN LEVEL (the most common top floor of the pad's columns, ties lower); with no top floor at all, the level that got
 * furthest through the pad.
 */
/** levelfall-01: a screened site's other feasible floor levels (least earthwork first) -> [L]. Pure. */
export const levelAltsOf = site => (Array.isArray(site?.alts) ? site.alts : [])
export function levelFor (read, home, pad, earth = EARTH, only = null) {
  let best = null, why = null, mostCols = -1
  const at = new Map()
  const feasible = []   // levelfall-01: every feasible level with its cost (the caller's fallback when a proof fails)
  for (let L = home.y - 12; L <= home.y + 12; L++) {
    if (only != null && L !== only) continue
    const cols = []
    let bad = null
    for (const [x, z] of pad) { const c = columnAt(read, x, z, L, earth); if (!c.ok) { bad = c; break } cols.push(c) }
    if (bad) { at.set(L, bad); if (cols.length > mostCols) { mostCols = cols.length; why = bad } continue }
    const fill = cols.reduce((n, c) => n + c.fill.length, 0), cut = cols.reduce((n, c) => n + c.cut.length, 0), litter = cols.reduce((n, c) => n + c.litter.length, 0)
    if (fill > earth.fill || cut > earth.cut || litter > LITTER_MAX) {
      const w = { why: litter > LITTER_MAX ? 'litter_over_40' : 'earthwork' }
      at.set(L, w)
      if (cols.length >= mostCols) { mostCols = cols.length; why = w }
      continue
    }
    const cost = fill + cut + litter
    feasible.push({ L, cost })
    if (!best || cost < best.cost || (cost === best.cost && Math.abs(L - home.y) < Math.abs(best.L - home.y))) best = { ok: true, L, cols, cost }
  }
  // levelfall-01: the OTHER feasible levels, least earthwork first (then nearest home's level, then the lower)
  if (best) return { ...best, alts: feasible.filter(f => f.L !== best.L).sort((a, b) => a.cost - b.cost || Math.abs(a.L - home.y) - Math.abs(b.L - home.y) || a.L - b.L).map(f => f.L) }
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
export function screenSite (read, home, bp, anchor, orient, res, { sector = null, domain = null, earth = EARTH, level = null } = {}) {
  const { pad, ring } = footprint(bp, anchor, orient)
  const all = [...pad, ...ring]
  // copperhall-01: a building on its own plan plot inside the town (the hall) names its domain; every other caller: the ring
  for (const [x, z] of all) if (!(domain ? domain(x, z) : inDomain(home, x, z))) return { ok: false, why: 'domain' }
  if (sector) for (const [x, z] of all) if (sectorOf(home, x, z) !== sector) return { ok: false, why: 'sector' }
  if (!facesHome(bp, home, anchor, orient)) return { ok: false, why: 'door_not_toward_home' }
  // ---- the plan and the records over the whole span a level may take ----
  for (const [x, z] of all) { const why = res.column(x, z, home.y - 16, home.y + 17); if (why) return { ok: false, why } }
  const xs = all.map(c => c[0]), zs = all.map(c => c[1])
  if (boxMeetsZones([Math.min(...xs), home.y - 16, Math.min(...zs), Math.max(...xs), home.y + 20, Math.max(...zs)], res.zones)) return { ok: false, why: 'zone' }
  // ---- the floor level (B4, D2) ----
  // copperhall-01: a larger building on a sloping plan plot names its own earthwork limits (`earth`); every other caller: EARTH
  // levelfall-01: `level` forces one floor level (the search's fallback after a failed proof); unset, the least earthwork's
  const lv = levelFor(read, home, pad, earth, level)
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
  return { ok: true, why: 'ok', anchor, orient, s, g0, pad, ring, fill, cut, clear, litter, trees, felled: felled.size, sector, alts: lv.alts ?? [] }
}

// ---- the walk and the proof ----------------------------------------------------------------------------------------------

/** A read with an overlay map "x,y,z" -> block. */
export function overlay (read, over) { return (x, y, z) => over.get(k3(x, y, z)) ?? read(x, y, z) }

/**
 * WHERE A BOT CAN WALK FROM TOWN -> Set of feet keys. Pure. A node: a full-cube floor, feet and head passable, dry and known;
 * `block` cells are OBSTACLES that are never a floor (cells still to place: a stand may not rely on a block that is not there);
 * `noFloor` cells are never a floor but may hold feet and head (monument-01: a fill the builder stands in);
 * 4-neighbour steps of dy -1, 0, +1 with head room (symmetric: a reached stand walks back); inside Chebyshev `radius` of home.
 * THE SEEDS (D3, r4): cells a bot STOOD on -- home's own start cell (the nearest node within 2 of home), and every `stood` feet
 * cell inside the town circle that is a node here. Never "every plaza cell" (Codex r1 P2: a moat inside the plaza), never "beside
 * a chest" (Codex r2/r3 P2: a chest in a wall is opened from either side).
 * standcache-01 (`graph`: an object the walk FILLS, for walkAgain): its seeds in order, every node's steps in order, the nodes' cells.
 */
export function walkFrom (read, home, block = new Set(), radius = WALK_R, { stood = [], noFloor = null, floors = null, avoid = null, graph = null } = {}) {
  const isNode = (x, y, z) => {
    // reroof-04 r5 (`avoid`: feet keys never a node -- a ledge whose fall lands off the town walk, reroof.mjs reroofFallRisk)
    if (avoid?.has(k3(x, y, z))) return false
    if (block.has(k3(x, y, z)) || block.has(k3(x, y + 1, z)) || block.has(k3(x, y - 1, z))) return false
    if (noFloor?.has(k3(x, y - 1, z))) return false             // monument-01: an open fill cell is never a floor
    const f = read(x, y - 1, z), a = read(x, y, z), h = read(x, y + 1, z)
    // reroof-04 (`floors`: a Set of a record's own cell keys): such a cell reading a TOP (or double) slab is a floor too -- its top face
    // is a full block's (Paper sandbox reroof4: mineflayer-pathfinder walks and stands on them); never a bottom slab, never another cell
    const floor = fullCube(f) || (!!floors && floors.has(k3(x, y - 1, z)) && slabTopFloor(f))
    return !!f && !!a && !!h && floor && isPassable(a) && isPassable(h) && !isLiquid(a) && !isLiquid(h)
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
  if (graph) {
    // standcache-01: the same walk, its steps kept ({ seeds: [key], adj: key -> [key], at: key -> [x, y, z], all: the Set returned })
    graph.seeds = q.map(c => k3(...c)); graph.adj = new Map(); graph.at = new Map(q.map(c => [k3(...c), c])); graph.all = seen
    for (let i = 0; i < q.length; i++) {
      const to = []
      for (const n of next(q[i], radius)) { const key = k3(...n); to.push(key); if (!seen.has(key)) { seen.add(key); q.push(n); graph.at.set(key, n) } }
      graph.adj.set(k3(...q[i]), to)
    }
    return seen
  }
  for (let i = 0; i < q.length; i++) for (const n of next(q[i], radius)) { const key = k3(...n); if (!seen.has(key)) { seen.add(key); q.push(n) } }
  return seen
}

/**
 * standcache-01: THE SAME WALK OVER OTHER OBSTACLES, WITHOUT READING THE WORLD AGAIN -> Set of feet keys: walkFrom(read, home, block,
 * radius, opts)'s own result, key for key and in the same order. `graph` is what a walk with NO obstacles kept (walkFrom's `graph`:
 * the same read, home, radius, stood, floors and avoid, block and noFloor empty) over the world as it still is.
 * (Measured 11-12, scripts/standbench.mjs: a 1,661-segment tidy record over a 100-block walled town through the bot's own block
 * read -- runVisit walked once per pass, 329,113 block reads and 251 ms at walkR 72, 580,284 and 484 ms at 96, and every segment's
 * obstacles are its own open cells, so no two passes ever asked for the same walk. From the kept steps: 0 block reads, 3 ms where
 * the obstacles touch the walk, nothing where they do not; about 15,000 reads and 17 ms where the seeds are chosen again.)
 * WHY IT IS THE SAME WALK. An obstacle only ever takes from the walk: `block` makes a cell, the cell over it and the cell under it no
 * node, and closes the head room of a step up from (or down to) the node two under it; `noFloor` makes the cell over it no node
 * (walkFrom's isNode and next). And a step never CHANGES where it lands: of a neighbour column's three heights at most one is a
 * node by what the world reads (a node's floor is a solid box, its feet and head are empty ones), so the obstacle walk's steps are
 * exactly the kept steps less the ones an obstacle closes -- a node reached only through a closed step drops out, because the walk
 * is walked again from the seeds over the kept steps (never patched). The seeds: an obstacle outside the town circle is never asked
 * about while they are chosen (every cell asked about there is in a column within TOWN_R of home), so they are the kept ones; with
 * an obstacle inside it they are chosen again by walkFrom itself (radius 0: the seeds and the town's pieces only), and if one of
 * them is no node of the kept walk the whole walk is made the old way.
 */
export function walkAgain (graph, read, home, block = new Set(), radius = WALK_R, { stood = [], noFloor = null, floors = null, avoid = null } = {}) {
  const { adj, at } = graph
  const dead = new Set(), low = new Set()
  let inTown = false
  const take = (k, floorOnly) => {
    const [x, y, z] = k.split(',').map(Number)
    if (Math.max(Math.abs(x - home.x), Math.abs(z - home.z)) <= TOWN_R) inTown = true
    for (const n of floorOnly ? [k3(x, y + 1, z)] : [k, k3(x, y + 1, z), k3(x, y - 1, z)]) if (adj.has(n)) dead.add(n)
    if (!floorOnly) { const u = k3(x, y - 2, z); if (adj.has(u)) low.add(u) }
  }
  for (const k of block) take(k, false)
  for (const k of noFloor ?? []) take(k, true)
  let seeds = graph.seeds
  if (inTown) {
    const g = {}
    walkFrom(read, home, block, 0, { stood, noFloor, floors, avoid, graph: g })
    if (!g.seeds.every(k => adj.has(k))) return walkFrom(read, home, block, radius, { stood, noFloor, floors, avoid })
    seeds = g.seeds
  } else if (!dead.size && !low.size) return graph.all            // no obstacle touches the kept walk: it IS the walk
  const seen = new Set(), q = []
  for (const k of seeds) if (!seen.has(k) && !dead.has(k)) { seen.add(k); q.push(k) }
  for (let i = 0; i < q.length; i++) {
    const y = at.get(q[i])[1], headShut = low.has(q[i])
    for (const m of adj.get(q[i])) {
      if (seen.has(m) || dead.has(m)) continue
      const dy = at.get(m)[1] - y
      if ((dy === 1 && headShut) || (dy === -1 && low.has(m))) continue
      seen.add(m); q.push(m)
    }
  }
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
 * cell (feet or head) and is in the build domain -- `domain(x, z)` when given (monument-01: ziggurat.mjs zigDomain, its record's
 * box + 6), else the workshop's ring (inDomain). Nearest wins.
 */
export function stepFor (read, home, cell, nodes, domain = null, want = null) {
  const [cx, cy, cz] = cell
  let best = null, bd = Infinity
  // cottage2-01: a HANGING lantern is clicked on the underside of the block above it (Paper 11-08: under a bottom stair and a bottom slab;
  // under a top slab vanilla stands it on the floor instead -- the state check then digs it): only such a cell takes the face above
  const hanging = want?.ws?.hanging === true || want?.ws?.hanging === 'true'
  for (const [fx, fy, fz] of hanging ? [...SUPPORTS, [0, 1, 0]] : SUPPORTS) {
    const sup = [cx + fx, cy + fy, cz + fz]
    if (!refUsable(read(...sup))) continue
    const normal = [0 - fx, 0 - fy, 0 - fz]   // never -0 (a record compares and serialises cleanly)
    // townstyle-01: A STATE-BEARING CELL (`want` = { name, ws }) takes only a face whose click makes that state (townstyle.mjs
    // orientAim: a top face never makes a top half, a log's axis is its face's); the step carries the click's `aim` (yaw, cursor)
    const aim = want?.ws ? orientAim(want.name, want.ws, normal) : null
    if (want?.ws && !aim) continue
    // townstyle-02: never a click that would turn its SUPPORT into a double slab (townstyle.mjs slabMerges)
    if (aim && slabMerges(want.name, read(...sup), normal, aim.cursor[1])) continue
    // townstyle-01: A REACH-ONLY CELL (`want.blind`, a pitched roof's upper courses: Paper places on reach alone -- the blind scene of
    // sandbox/townstyle/orient-proof.mjs): the face need not be on the eye's side nor in its sight; the reach rule stands
    const blind = !!want?.blind
    const fc = [sup[0] + 0.5 + normal[0] * 0.5, sup[1] + 0.5 + normal[1] * 0.5, sup[2] + 0.5 + normal[2] * 0.5]
    for (let dx = -5; dx <= 5; dx++) for (let dz = -5; dz <= 5; dz++) {
      const sx = cx + dx, sz = cz + dz
      const ys = nodes.get(k2(sx, sz))
      if (!ys || !(domain ? domain(sx, sz) : inDomain(home, sx, sz))) continue
      for (const sy of ys) {
        if (sx === cx && sz === cz && (sy === cy || sy + 1 === cy)) continue
        // cottage2-01: never a stand in a cell the click also fills (a bed's head: `want.also`)
        if (want?.also?.some(([ax, ay, az]) => sx === ax && sz === az && (sy === ay || sy + 1 === ay))) continue
        const eye = [sx + 0.5, sy + EYE, sz + 0.5]
        const v = [eye[0] - fc[0], eye[1] - fc[1], eye[2] - fc[2]]
        const d = Math.hypot(...v)
        if (d > REACH || d >= bd) continue
        if (!blind && v[0] * normal[0] + v[1] * normal[1] + v[2] * normal[2] <= 0) continue
        if (!blind && !sightClear(read, eye, fc, new Set([k3(cx, cy, cz)]))) continue
        best = { stand: [sx, sy, sz], support: sup, face: normal, ...(aim ? { aim } : {}) }; bd = d
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
export function proveSite (read, home, bp, site, opts = {}) {
  const g = proveSiteSteps(read, home, bp, site, opts)
  for (;;) { const r = g.next(); if (r.done) return r.value }
}
/**
 * SITEPROOF-01 (LIVE showcase 11-12: 39 `lost connection: Timed out` in 80 minutes, each a bot offline about 5 minutes; a stack
 * taken from a bot at 100% CPU: walkFrom <- walkNow <- proveSite <- siteBlueprintSteps <- siteBlueprintAsync). THE PROOF AS A
 * GENERATOR: proveSite's own steps, yielding after EVERY walk of the town. One walk is 1.0 to 6.0 s on that host (walkR 48 to
 * 136, bots/scripts/standbench.mjs, measured there), a proof walks once a segment at least and once more at its end, and the
 * search's cooperative runner (siteBlueprintAsync) could only take its turn BETWEEN proofs -- so one proof of a ten-segment
 * blueprint held the event loop past the server's 30-s keep-alive whenever the host was busy. Yielding after EVERY walk (the
 * finished building's too: the search walks again right after a proof) bounds the hold to ONE walk. The result is proveSite's, value for value: nothing is read or decided differently.
 */
export function * proveSiteSteps (read, home, bp, site, { stood = [], domain = null, walkR = WALK_R, floors = null, gone = null, interiorNow = null, avoid = null, planned = null } = {}) {
  // planahead-01 (`planned` = { block: Set, noFloor: Set }, planahead.mjs plannedWorld): the other open records' work still to place is an
  // obstacle and never a floor, their open clears never a floor -- the proof is made in the PLANNED town, never only the town as it is
  const pBlock = planned?.block instanceof Set ? planned.block : null, pNoFloor = planned?.noFloor instanceof Set && planned.noFloor.size ? planned.noFloor : null
  // storehouse-01: a building inside the town (its plan plot beside the plaza) names its stands' domain (stepFor's), as the visit does
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
    // cottage2-01: a bed's HEAD is never clicked -- the foot's click puts it there (it rides with its foot, below)
    const left = mine.filter(c => !c.byFoot).sort((a, b) => a.at[1] - b.at[1] || a.u - b.u || a.v - b.v)
    const headOf = c => (c.role === 'bed' && c.bed ? mine.find(h => h.byFoot && h.bed === c.bed) ?? null : null)
    const walkNow = () => byColumn(walkFrom(R, home, new Set([...(pBlock ?? []), ...left.filter(c => (ROLE_BOX[c.role] ?? 'block') === 'block').map(c => k3(...c.at))]), walkR, { stood, floors, avoid, ...(pNoFloor ? { noFloor: pNoFloor } : {}) }))
    let nodes = walkNow(), fresh = true, walks = 1
    yield null
    while (left.length) {
      let pick = -1, step = null
      for (let i = 0; i < left.length; i++) {
        const hd = headOf(left[i])
        step = stepFor(R, home, left[i].at, nodes, domain, left[i].ws || left[i].blind || hd ? { name: blockFor(bp, left[i].role), ws: left[i].ws ?? null, blind: !!left[i].blind, ...(hd ? { also: [hd.at] } : {}) } : null)
        if (step) { pick = i; break }
      }
      if (pick < 0 && !fresh) { nodes = walkNow(); fresh = true; walks++; yield null; continue }
      if (pick < 0) return { ok: false, why: 'no_step', detail: `${sg.seg} ${left.length} left, first ${left[0].role}@${left[0].at.join(',')}`, segments: segOut }
      fresh = false
      const c = left.splice(pick, 1)[0]
      over.set(k3(...c.at), Object.freeze({ name: blockFor(bp, c.role), boundingBox: ROLE_BOX[c.role] ?? 'block', ...(c.ws ? { props: c.ws } : {}) }))   // townstyle-02: a placed state cell's state (a slab's half)
      out.push({ at: c.at, role: c.role, seg: c.seg, stand: step.stand, support: step.support, face: step.face, order: order++, ...(c.ws ? { ws: c.ws } : {}), ...(c.blind ? { blind: true } : {}), ...(c.bed ? { bed: c.bed } : {}) })
      const hd = headOf(c)
      if (hd) {
        over.set(k3(...hd.at), Object.freeze({ name: blockFor(bp, hd.role), boundingBox: 'block', ...(hd.ws ? { props: hd.ws } : {}) }))
        out.push({ at: hd.at, role: hd.role, seg: hd.seg, stand: step.stand, support: c.at, face: [0, 0, 0], order: order++, ...(hd.ws ? { ws: hd.ws } : {}), bed: hd.bed, byFoot: true })
      }
    }
    segOut.push({ seg: sg.seg, layer: sg.layer, deps: sg.deps, cells: mine.length, walks, stands: new Set(out.filter(o => o.seg === sg.seg).map(o => k3(...o.stand))).size })
  }
  // the finished building: EVERY open interior floor cell is walked to from town through the open doorway
  // reroof-04 (`gone`: fill keys a temporary stand holds -- torn down once the roof stands): the finished building is walked WITHOUT them
  const final = walkFrom(gone?.size ? overlay(R, new Map([...gone].map(k => [k, AIR]))) : R, home, new Set(pBlock ?? []), walkR, { stood, floors, avoid, ...(pNoFloor ? { noFloor: pNoFloor } : {}) })
  yield null   // siteproof-01 (Claude r1 note): after the LAST walk too -- the search's next walk (the replant's, the next level's proof) follows at once
  const solidInside = new Set(cells.filter(c => (ROLE_BOX[c.role] ?? 'block') === 'block').map(c => k3(...c.at)))
  const interior = bp.interior.filter(([, , y]) => y === 1).map(([u, v]) => { const { dx, dz } = rot(site.orient, u, v); return k3(site.anchor.x + dx, site.s + 1, site.anchor.z + dz) })
  // reroof-04 (`interiorNow(key)`, a retrofit: NEVER WORSE) only the interior cells the town walks to NOW must stay walked (LIVE 11-08: a
  // missing floor block in the enchanting workshop -- its own repair's -- left one interior cell unwalked before any roof work)
  const open = interior.filter(k => !solidInside.has(k) && (!interiorNow || interiorNow(k)))
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
export function replantCellAt (read, home, x, z, res, nodes, domain = null) {
  const g = groundOf(read, x, z, home.y)
  if (g == null || !SOIL.has(nm(read(x, g, z)))) return null
  for (let y = g + 1; y <= g + REPLANT.clear; y++) { const b = read(x, y, z); if (!b || nm(b) !== 'air') return null }
  if (res?.column?.(x, z, g, g + 1) || boxMeetsZones([x, g, z, x, g + 1, z], res?.zones ?? [])) return null
  const step = stepFor(read, home, [x, g + 1, z], nodes, domain)
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
export function replantFor (read, home, site, res, walk, domain = null) {
  if (!site.trees.length) return { ok: true, cells: [] }
  const footprint = new Set([...site.pad, ...site.ring].map(([x, z]) => k2(x, z)))
  const cand = replantBand(site.pad, footprint)
  const nodes = byColumn(walk)
  const used = new Set(), out = []
  for (const t of site.trees) {
    let got = null
    for (const [, x, z] of cand) {
      if (used.has(k2(x, z))) continue
      const cell = replantCellAt(read, home, x, z, res, nodes, domain)
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
  const g = siteBlueprintSteps(read, plan, bp, ctx)
  for (;;) { const r = g.next(); if (r.done) return r.value }
}
/**
 * yardsite-01: siteBlueprint COOPERATIVELY -> a Promise of siteBlueprint's result. The same search (siteBlueprintSteps), handing
 * the event loop back every `sliceMs` (a wide search -- the yard's, out to 80 -- runs 10-60 s: a bot that never yields misses its
 * keep-alives); `aborted()` true ends it with { ok: false, why: 'aborted' }. Never changes the result.
 */
export async function siteBlueprintAsync (read, plan, bp, ctx = {}, { sliceMs = 40, aborted = () => false, maxMs = siteBoxOn() ? SITE_SEARCH_MS : Infinity } = {}) {
  const g = siteBlueprintSteps(read, plan, bp, ctx)
  const t0 = Date.now()
  let token = null
  try { token = siteSearchHook ? siteSearchHook.begin({ maxMs }) : null } catch { token = null }
  try {
    let t = Date.now()
    for (;;) {
      const r = g.next()
      if (r.done) return r.value
      if (Date.now() - t >= sliceMs) {
        await new Promise(resolve => setImmediate(resolve))
        if (aborted()) return { ok: false, why: 'aborted', record: null, sectors: [] }
        // sitebox-01: the search's own time box (see SITE_SEARCH_MS) -- an ordinary "no site", by name
        if (Date.now() - t0 >= maxMs) return { ok: false, why: 'search_time', detail: `${Math.round((Date.now() - t0) / 1000)}s`, record: null, sectors: [] }
        t = Date.now()
      }
    }
  } finally { try { if (siteSearchHook) siteSearchHook.end(token) } catch { /* the hook never costs the search */ } }
}
/**
 * SITEBOX-01 (LIVE showcase 11-13 00:49-01:55Z, after siteproof-01/02 made the search hand the event loop back between walks: 33 of
 * 80 build visits `aborted`, 24 by `interrupt:stuck` at about 33 s with not one row inside; 26 of the 33 by bots whose project had
 * NO RECORD -- a siting). A cooperative search stands the bot still while it runs, the stuck reflex (reflex.mjs stuckDecision: no
 * movement for 35 s) aborted the visit mid-search, the search never ended, `no_site` was never recorded (so no site retry hold and
 * no idle mark), and the bot ran the same search again at its next build order. Before the search yielded it froze the bot instead,
 * which hid this (and got bots kicked).
 * TWO THINGS, together:
 *   1. THE SEARCH DECLARES THE BOT STILL while it runs (`setSiteSearchHook`: skills.mjs installs siteStillBegin / siteStillEnd over
 *      bot.stationaryUntil -- the declaration the composter and the wood kit already make, honoured by stuckDecision), given back
 *      when the search ends however it ends.
 *   2. THE SEARCH HAS A TIME BOX (`maxMs`, SITE_SEARCH_MS = 100 s: under a build visit's 180 s, over the 10-60 s a wide search
 *      takes): past it the answer is `{ ok: false, why: 'search_time' }` -- to every caller an ordinary failed siting, so the visit
 *      ends `no_site` and the order's existing site retry hold and idle mark apply. Never a new stop name.
 * SITEBOX=off|0|false|no: no box and no declaration (the search as before).
 */
export const SITE_SEARCH_MS = 100_000
export const siteBoxOn = (env = process.env) => !/^(off|0|false|no)$/i.test(String(env?.SITEBOX ?? '').trim())
let siteSearchHook = null
/** sitebox-01: `{ begin({ maxMs }) -> token, end(token) }` called round every cooperative search (skills.mjs installs it); null clears. */
export function setSiteSearchHook (h) { siteSearchHook = h && typeof h.begin === 'function' && typeof h.end === 'function' ? h : null }
/** sitebox-01: THE DECLARATION -> token | null. The bot stands still by design until the search's box ends (+ `marginMs`: the last
 *  step may be a walk of the town); a longer declaration already made is kept. No bot, or no box (maxMs not finite): nothing declared. */
export function siteStillBegin (bot, maxMs, { now = Date.now(), marginMs = 15_000 } = {}) {
  if (!bot || !(Number.isFinite(maxMs) && maxMs > 0)) return null
  const until = now + maxMs + marginMs
  bot.stationaryUntil = Math.max(Number(bot.stationaryUntil) || 0, until)
  return { bot, until }
}
/**
 * sitebox-01 (Claude r1 BLOCKER): DOES THIS ANSWER END THE WHOLE SITING? -> 'aborted' | 'search_time' | null. Pure. A siting that
 * tries several blueprints, styles or bands in a loop (the cottage's styles, the yard's sizes, the hub's steps) ends at the FIRST
 * search the box ended: ONE box a siting -- else every try gets its own 100 s, the visit runs to the runner's 180-s abort standing
 * still, and nothing is recorded (worse than the reflex's 35 s). `aborted` ends it as before.
 */
export const siteLoopEnds = s => (s?.why === 'aborted' ? 'aborted' : s?.why === 'search_time' ? 'search_time' : null)
/**
 * sitebox-01 (review r2, Codex and Claude): ONE BOX A SITING -> { left(now?) -> ms }. A siting that searches more than once takes
 * one box at its start and gives each search only what is LEFT of it (`maxMs: box.left()`): tries that each end "no site" inside
 * their own 100 s must not add up past the visit (three cottage looks at 65 s each = 195 s standing still, the runner's abort at
 * 180 s, nothing recorded). A spent box leaves 0: the next search ends `search_time` at its first turn, and siteLoopEnds ends the
 * siting. SITEBOX off: Infinity (no box). Pure but for the clock it is given.
 */
export function siteBox (ms = siteBoxOn() ? SITE_SEARCH_MS : Infinity, now = Date.now()) {
  const until = now + ms
  return { left: (t = Date.now()) => (Number.isFinite(until) ? Math.max(0, until - t) : Infinity) }
}
/** sitebox-01: ...given back -- only this search's own declaration (a later, longer one of another's stands). */
export function siteStillEnd (token) { if (token?.bot && token.bot.stationaryUntil === token.until) token.bot.stationaryUntil = 0 }
/** THE SEARCH as a generator: yields between anchors and proofs (siteBlueprint runs it straight through). */
export function * siteBlueprintSteps (read, plan, bp, ctx = {}) {
  const home = plan?.home
  if (!home) return { ok: false, why: 'no_plan', sectors: [] }
  // house-01: a caller may name the sectors (a house: the workshop's sector first, then the free ones); else the workshop's
  const secs = Array.isArray(ctx.sectors) ? ctx.sectors : workshopSectors(plan)
  if (!secs.length) return { ok: false, why: 'no_free_sector', sectors: [] }
  // yardsite-01: the reservation test is pure over (x, z, y0, y1): asked once per column and span, not once per candidate
  const res0 = reservations(plan, ctx), colMemo = new Map()
  const res = { ...res0, column: (x, z, y0, y1) => { const k = `${x},${z},${y0},${y1}`; let v = colMemo.get(k); if (v === undefined) { v = res0.column(x, z, y0, y1); colMemo.set(k, v) } return v } }
  const stood = [...(ctx.stood ?? []), ...planTownCells(plan)]
  const out = []
  // yardsite-01: a caller may name the screen's DOMAIN (`ctx.domain(x, z)`: the yard beyond the town ring), how far the anchors
  // are scanned (`ctx.line`), the stands' domain (`ctx.standDomain`) and the town walk's radius (`ctx.walkR`) for the proof and
  // the replant; unset, every one is the workshop ring's as before (DOMAIN, WALK_R)
  const domain = typeof ctx.domain === 'function' ? ctx.domain : null
  const line = Number.isFinite(ctx.line) ? ctx.line : DOMAIN.line
  const walkR = Number.isFinite(ctx.walkR) ? ctx.walkR : WALK_R
  // a caller may judge the sector by the footprint's CENTRE (`ctx.sectorBy: 'centre'`: the yard, a land-plan zone is a 45-degree
  // wedge and an 18 x 26 floor fits inside one only far out); unset, every footprint cell must lie in the sector, as before
  const byCentre = ctx.sectorBy === 'centre'
  // leaffell-01show (`ctx.leafFell`, sitecanopy.mjs cellClearsHook): the hook's fell-first options for this search (null: none)
  if (typeof ctx.cellClears === 'function' && ctx.leafFell !== undefined) ctx.cellClears.leafFell = ctx.leafFell
  const cu = Math.floor(bp.footprint.u / 2), cv = Math.floor(bp.footprint.v / 2)
  for (const { sector, source } of secs) {
    const rejects = {}, ok = []
    for (const orient of ORIENTS) {
      for (let x = home.x - line; x <= home.x + line; x++) {
        if ((x & 7) === 0) yield null
        for (let z = home.z - line; z <= home.z + line; z++) {
          // the anchor is a pad cell (rot(orient, 0, 0) is 0, 0): with a named domain, an anchor outside it or its sector is the
          // screen's own `domain` / `sector` refusal, counted without the footprint walk (the wider scan stays cheap)
          if (domain && !domain(x, z)) { rejects.domain = (rejects.domain ?? 0) + 1; continue }
          if (byCentre && sector) { const [qx, qz] = at2({ x, z }, orient, cu, cv); if (sectorOf(home, qx, qz) !== sector) { rejects.sector = (rejects.sector ?? 0) + 1; continue } } else if (domain && sector && sectorOf(home, x, z) !== sector) { rejects.sector = (rejects.sector ?? 0) + 1; continue }
          // stockyard-01: a caller may name its earthwork limits (`ctx.earth`: the yard's 17 x 15 floor); else screenSite's EARTH
          const r = screenSite(read, home, bp, { x, z }, orient, res, { sector: byCentre ? null : sector, ...(domain ? { domain } : {}), ...(ctx.earth ? { earth: ctx.earth } : {}) })
          if (r.ok) ok.push(r); else rejects[r.why] = (rejects[r.why] ?? 0) + 1
        }
      }
    }
    const dist = r => Math.hypot(r.pad[0][0] - home.x, r.pad[0][1] - home.z)
    // yardsite-01: a caller may rank first by its own key (`ctx.rankKey(site)`, smaller first: the yard's nearest band); then as before
    const rk = typeof ctx.rankKey === 'function' ? ctx.rankKey : () => 0
    ok.sort((a, b) => rk(a) - rk(b) || (a.fill.length + a.cut.length + a.litter) - (b.fill.length + b.cut.length + b.litter) || a.trees.length - b.trees.length || dist(a) - dist(b))
    const proofFails = {}
    const tries = Math.min(ok.length, ctx.tries ?? PROOF_TRIES)
    const row = { sector, source, screened: ok.length, tried: 0, rejects, proofFails }
    out.push(row)
    for (let i = 0; i < tries; i++) {
      yield null
      let site = ok[i]
      row.tried = i + 1
      const proveOpts = { stood, walkR, ...(typeof ctx.standDomain === 'function' ? { domain: ctx.standDomain } : {}), ...(ctx.planned ? { planned: ctx.planned } : {}) }
      // sitecanopy-01 (`ctx.cellClears(site)` -> null | { clear } | { fail }): the caller may list more clears for this candidate (the
      // natural leaves in a styled building's own cells, sitecanopy.mjs), or fail it by name (they would never be reached)
      if (typeof ctx.cellClears === 'function') {
        // siteproof-02: the hook's own steps when it has them (sitecanopy.mjs cellClearsHook `steps`: its reach test walks the town
        // once a clear it digs) -- the search takes its turn after every one of those walks too
        const xc = typeof ctx.cellClears.steps === 'function' ? yield * ctx.cellClears.steps(site) : ctx.cellClears(site)
        if (xc?.fail) { proofFails[xc.fail] = (proofFails[xc.fail] ?? 0) + 1; if (xc.detail && (row.proofEx ??= []).length < 3) row.proofEx.push(`${site.anchor.x},${site.anchor.z}/${site.orient} ${xc.fail} ${xc.detail}`.slice(0, 120)); continue }
        // leaffell-01show (sitecanopy.mjs cellClearsHook `leafFell`): a tree the hook lists so the leaves it holds decay is felled only
        // where the screen fells its own -- never a log in a plan reservation or a zone (`leaf_tree_reserved`: the next candidate)
        if (xc?.fellLogs?.some(at => trunkReserved(res, at))) { proofFails.leaf_tree_reserved = (proofFails.leaf_tree_reserved ?? 0) + 1; continue }
        if (xc?.leaf) {
          // ...the leaves that only wait for a trunk are marked on the site's own list too, and the trees' saplings join the site's
          const dk = new Set((xc.decay ?? []).map(a => a.join(',')))
          site = { ...site, clear: [...site.clear.map(c => (dk.has(c.at.join(',')) ? { ...c, decay: 1 } : c)), ...(xc.clear ?? [])], trees: [...site.trees, ...(xc.trees ?? [])], felled: site.felled + (xc.trees?.length ?? 0), leaf: xc.leaf }
        } else if (xc?.clear?.length) site = { ...site, clear: [...site.clear, ...xc.clear] }
      }
      let p = yield * proveSiteSteps(read, home, bp, site, proveOpts)
      // levelfall-01 (LIVE showcase 11-05, the workshop on X1: its one anchor's proof failed `no_step earth` -- a cave pocket y 65..68
      // under the plot's grass at 69, the fill at 65 out of every stand's reach): a caller naming `ctx.levelAlts` has the SAME anchor
      // and orientation screened and proven at its next feasible floor levels (a level whose floor is the pocket's lid fills none)
      if (!p.ok && Number(ctx.levelAlts) > 0) {
        for (const L2 of (levelAltsOf(site) ?? []).slice(0, Number(ctx.levelAlts))) {
          const s2 = screenSite(read, home, bp, site.anchor, site.orient, res, { sector: byCentre ? null : sector, ...(domain ? { domain } : {}), ...(ctx.earth ? { earth: ctx.earth } : {}), level: L2 })
          if (!s2.ok) continue
          const p2 = yield * proveSiteSteps(read, home, bp, s2, proveOpts)
          if (p2.ok) { site = s2; p = p2; row.levelFallback = `${site.anchor.x},${site.anchor.z}/${site.orient} L${L2}`; break }
        }
      }
      if (!p.ok) { proofFails[p.why] = (proofFails[p.why] ?? 0) + 1; if ((row.proofEx ??= []).length < 3) row.proofEx.push(`${site.anchor.x},${site.anchor.z}/${site.orient} ${p.why} ${p.detail ?? ''}`.slice(0, 120)); continue }
      // planahead-01 (`ctx.standCheck(site, cells)` -> null | { plot, at, kind }, planahead.mjs standConflicts): a candidate that would fill
      // another unfinished building's stand or dig its floor is not this town's site -- the search moves on (never a stand taken away)
      if (typeof ctx.standCheck === 'function') { const hit = ctx.standCheck(site, p.cells); if (hit) { proofFails.stand_claimed = (proofFails.stand_claimed ?? 0) + 1; if ((row.proofEx ??= []).length < 3) row.proofEx.push(`${site.anchor.x},${site.anchor.z}/${site.orient} stand_claimed ${hit.plot}@${hit.at.join(',')}`.slice(0, 120)); continue } }
      const over = new Map()
      for (const c of site.clear) over.set(k3(...c.at), AIR)
      for (const c of site.fill) over.set(k3(...c), SOLID('cobblestone'))
      // leaffell-01show (`ctx.leafReplantDomain`): a site that fells a tree BESIDE its pad for its leaves plants the saplings from the town
      // walk (the visit: buildrun.mjs `p.replantDomain`) -- the stands' own domain (the pad + 3) holds no cell of the replant band (8..24)
      const rpDomain = site.leaf?.trees && typeof ctx.leafReplantDomain === 'function' ? ctx.leafReplantDomain : typeof ctx.standDomain === 'function' ? ctx.standDomain : null
      const rp = replantFor(read, home, site, res, walkFrom(overlay(read, over), home, new Set(), walkR, { stood }), rpDomain)
      if (!rp.ok) { proofFails.no_replant_cell = (proofFails.no_replant_cell ?? 0) + 1; continue }
      const xs = site.pad.map(c => c[0]), zs = site.pad.map(c => c[1])
      const record = {
        v: 1, blueprint: bp.id, plot: ctx.plot ?? 'shop', home, sector, sector_source: source, orient: site.orient, anchor: [site.anchor.x, site.anchor.z],
        box: [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)], s: site.s, floor: site.g0,
        earthwork: { fill: site.fill.length, cut: site.cut.length, litter: site.litter },
        fill: site.fill, clear: site.clear.map(c => ({ at: c.at, kind: c.kind, name: c.name, ...(c.decay === 1 ? { decay: 1 } : {}), ...(Number.isFinite(c.tree) ? { tree: c.tree } : {}) })),
        ...(site.leaf ? { leaffell: { ...site.leaf } } : {}),
        trees: site.trees.map(t => ({ base: t.base, species: t.species, logs: t.logs })), felled: site.felled,
        // leaffell-01show: a tree felled for its leaves carries a `tree` tag; its sapling carries the same (replantFor answers in the trees' order)
        replant: rp.cells.map((c, i) => (Number.isFinite(site.trees[i]?.tree) ? { ...c, tree: site.trees[i].tree } : c)),
        cells: p.cells, segments: p.segments, interior: p.interior, bom: billOf(bp, p.cells), builders_max: 2,
        structure_complete: false, plan: { gen: plan.gen }, stood_seeds: stood.length,
        ...(walkR !== WALK_R ? { walkR } : {}),
      }
      return { ok: true, why: 'ok', record, sectors: out }
    }
  }
  const any = out.some(r => r.screened)
  return { ok: false, why: any ? 'no_proven_site' : 'no_site', record: null, sectors: out }
}
