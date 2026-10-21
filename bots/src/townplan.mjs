// THE TOWN PLAN (townplan-01; design docs/reports/town-plan-2026-10-20.md sections 3-6, build spec
// docs/reports/townplan-found-spec-2026-10-21.md section 1). WHERE A TOWN'S THINGS GO, decided once, in a file every bot
// reads (planstore.mjs), before anything is built.
//
// WHY (measured 10-20, the design's section 1): 348 town containers hold their items scattered (80% partial stacks, 78%
// holding 3+ groups), 769 crafting tables and 176 furnaces stand wherever a craft or a smelt happened, and the junk well, the
// composter and the tree farm were sited one at a time with no common map. A fresh town (the showcase) grows the same way
// unless its first chest, table and furnace have somewhere to go (found-01). This module is the map; it moves nothing.
//
// PURE over `read(x, y, z) -> { name, boundingBox, shapes? } | null` (null = UNKNOWN: never planned on a guess). No bot, no
// file. The fit (greenfield, annex, retrofit), READY cells, joint access, outer-plot sectors around protected zones, the
// keep-out predicates the adopters call, and the plan's maintenance steps all live here; skills.mjs supplies the reads.
//
// TOWNPLAN=off is the one-setting rollback: no plan is written or read, and every adopter behaves as on the base.

import { TOWN_DY } from './chestfull.mjs'
import { siteRefusal as composterSiteRefusal } from './composter.mjs'
import { chestLidBlocked, serverLidBlocks } from './lidrule.mjs'

export const TOWNPLAN = Object.freeze({ on: process.env.TOWNPLAN !== 'off' })
export const TEMPLATE = 'ring@1'
export const ORIENTS = Object.freeze(['E', 'S', 'W', 'N'])
/** The town circle (chestfull inTown): straight-line 16, TOWN_DY up or down. */
export const STORAGE_R = 16
/** The fit reads every column within this Chebyshev distance of home (the joint-access walk stays inside it). */
export const FIT_R = 20
/** The planner's ground search: this far above and below home's level. */
export const FIT_DY = 12
/** A stand's eyes reach a container centre within this (the server's interaction range is ~4.5 at the feet + 1.62). */
export const REACH = 4.0
/** The planner tick (index.mjs) and the reservation TTL (found-01). */
export const PLAN_TICK_MS = 30_000

const LIQUID_RE = /^(water|lava|flowing_water|flowing_lava|bubble_column)$|\[waterlogged\]$/
const FLOOR_NO = /(^chest$|^trapped_chest$|^barrel$|^composter$|^crafting_table$|furnace$|^smoker$|_leaves$|^dirt_path$|^farmland$|_slab$|_stairs$|_door$|_trapdoor$|^scaffolding$|^ice$|shulker_box$|^hopper$|_fence$|_wall$|_pane$|^glass$|_bed$|^lectern$|^bell$)/
/** Cells a placement replaces (vanilla's replaceable plants; liquid is excluded by READY's own rule). Measured on the showcase
 *  ground 10-21: large ferns and tall grass under the spruce made every ring@1 fit fail with the composter's narrower set. */
export const PLACEABLE_INTO = new Set(['air', 'cave_air', 'short_grass', 'tall_grass', 'fern', 'large_fern', 'dead_bush', 'vine', 'glow_lichen'])
/** Is this cell replaceable by a placement? Snow only at ONE layer (vanilla SnowLayerBlock.canBeReplaced: layers == 1); a snow
 *  cell whose depth is not in its props is not (Codex/Claude spec r6). Pure. */
export function replaceableCell (b) {
  if (!b) return false
  const n = nm(b)
  if (n === 'snow') return Number(b.props?.layers) === 1
  return PLACEABLE_INTO.has(n)
}
/** READY's lid rule, also the audit's: lidrule's chestLidBlocked OR serverLidBlocks (leaves and glass open; a full solid, mud
 *  and soul sand do not). Pure. */
export const lidBlocks = b => !!b && (chestLidBlocked(b) || serverLidBlocks(b))
const TREEISH = /(_log$|_wood$|_leaves$|_sapling$|^mangrove_roots$|_stem$|^bamboo$)/
export const FURNITURE = /^(chest|trapped_chest|barrel|ender_chest|crafting_table|furnace|blast_furnace|smoker|composter|lectern|bell|brewing_stand|anvil|.*_bed|hopper|smithing_table|stonecutter|grindstone|loom|cartography_table|fletching_table)$/
export const CONTAINER = /^(chest|trapped_chest|barrel)$/
const TERRAIN = /^(stone|cobblestone|mossy_cobblestone|stone_bricks|deepslate|cobbled_deepslate|andesite|diorite|granite|tuff|calcite|dripstone_block|smooth_basalt|sandstone|red_sandstone|dirt|coarse_dirt|rooted_dirt|grass_block|podzol|mycelium|mud|clay|sand|red_sand|gravel|dirt_path|farmland|terracotta|[a-z_]+_terracotta|moss_block|snow_block|packed_ice)$|_ore$/

const nm = b => String(b?.name ?? '')
export const isLiquid = b => !!b && LIQUID_RE.test(nm(b))
export const isPassable = b => !!b && b.boundingBox === 'empty' && !isLiquid(b)
export const isSolid = b => !!b && b.boundingBox === 'block'
/** A full cube a container may stand on (no partial shapes, nothing that is itself furniture, path, leaves, ice...). */
export function isSolidFull (b) {
  if (!isSolid(b) || FLOOR_NO.test(nm(b)) || isLiquid(b)) return false
  if (Array.isArray(b.shapes) && b.shapes.length) {
    if (b.shapes.length !== 1) return false
    const [x0, y0, z0, x1, y1, z1] = b.shapes[0]
    if (x0 !== 0 || y0 !== 0 || z0 !== 0 || x1 !== 1 || y1 !== 1 || z1 !== 1) return false
  }
  return true
}
export const isTreeish = b => !!b && TREEISH.test(nm(b))
export const isFurniture = b => !!b && FURNITURE.test(nm(b))
export const isTerrain = b => !!b && TERRAIN.test(nm(b))
const k3 = (x, y, z) => `${x},${y},${z}`
const kOf = a => k3(a[0], a[1], a[2])

// ---- geometry ----------------------------------------------------------------------------------------------------------

/** (u out toward the storehouse, v lateral) -> (dx, dz) for an orientation. E (u,v) -> (u,v); S -> (-v,u); W -> (-u,-v); N -> (v,-u). */
export function rot (orient, u, v) {
  switch (orient) {
    case 'E': return { dx: u, dz: v }
    case 'S': return { dx: -v, dz: u }
    case 'W': return { dx: -u, dz: -v }
    case 'N': return { dx: v, dz: -u }
    default: throw new Error(`orientation ${orient}`)
  }
}
const OPP = { E: 'W', W: 'E', N: 'S', S: 'N' }
/** The cardinal a lateral +v / -v points to, for an orientation. */
export function lateralOf (orient, side) {
  const { dx, dz } = rot(orient, 0, side)
  return dx > 0 ? 'E' : dx < 0 ? 'W' : dz > 0 ? 'S' : 'N'
}
/** A box [x0, z0, x1, z1] from (u, v) corners. */
function boxOf (home, orient, u0, v0, u1, v1) {
  const a = rot(orient, u0, v0), b = rot(orient, u1, v1)
  return [Math.min(a.dx, b.dx) + home.x, Math.min(a.dz, b.dz) + home.z, Math.max(a.dx, b.dx) + home.x, Math.max(a.dz, b.dz) + home.z]
}
/** The 13 container cells along the storehouse's three inner walls (orientation-local u, v), in perimeter order. */
const STORE_PERIMETER = [[9, -2], [10, -2], [11, -2], [12, -2], [13, -2], [13, -1], [13, 0], [13, 1], [13, 2], [12, 2], [11, 2], [10, 2], [9, 2]]
/** Chests on the alternate cells (they never share a side): 7 chests, 189 slots (design section 3). */
export const STORE_CHESTS_UV = STORE_PERIMETER.filter((_, i) => i % 2 === 0)
export const DOOR_UV = [8, 0]
/** Fill order: distance to the door, then perimeter order -> [(9,-2) OVERFLOW, (9,2), (11,-2), (11,2), (13,0), (13,-2), (13,2)]. */
export const STORE_FILL_UV = STORE_CHESTS_UV.map((c, i) => ({ c, i, d: Math.hypot(c[0] - DOOR_UV[0], c[1] - DOOR_UV[1]) }))
  .sort((a, b) => a.d - b.d || a.i - b.i).map(o => o.c)
/** The interior's middle 3x3, where a chest's stand is (nearest; ties lower u, then lower v). */
const STAND_UV = []; for (let u = 10; u <= 12; u++) for (let v = -1; v <= 1; v++) STAND_UV.push([u, v])
const standUvFor = ([cu, cv]) => STAND_UV.slice().sort((a, b) => (Math.hypot(a[0] - cu, a[1] - cv) - Math.hypot(b[0] - cu, b[1] - cv)) || a[0] - b[0] || a[1] - b[1])[0]
/** The workshop's stations along u 7..11 on row v = 7 * side; stands on v = 6 * side (the core side). */
export const STATION_KINDS = Object.freeze(['crafting_table', 'furnace', 'furnace', 'crafting_table', 'furnace'])

/**
 * RING@1 AT (home, s, orientation, workshop side) -> the plots' boxes and cells. Pure.
 */
export function ring1 (home, s, orient, side = 1) {
  const at = (u, v, y) => { const { dx, dz } = rot(orient, u, v); return [home.x + dx, y, home.z + dz] }
  const cells = STORE_FILL_UV.map(([u, v], i) => ({ at: at(u, v, s + 1), kind: 'chest', stand: at(...standUvFor([u, v]), s + 1), fill: i }))
  const stations = STATION_KINDS.map((kind, i) => ({ at: at(7 + i, 7 * side, s + 1), kind, stand: at(7 + i, 6 * side, s + 1) }))
  return {
    core: boxOf(home, orient, -6, -6, 6, 6),
    storeBox: boxOf(home, orient, 7, -4, 15, 4),
    wallsBox: boxOf(home, orient, 8, -3, 14, 3),
    door: at(DOOR_UV[0], DOOR_UV[1], s + 1),
    cells,
    workBox: side > 0 ? boxOf(home, orient, 7, 6, 11, 8) : boxOf(home, orient, 7, -8, 11, -6),
    stations,
    wellSector: OPP[orient],
    farmSector: lateralOf(orient, -side),
    farmEdge: [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6].map(u => { const { dx, dz } = rot(orient, u, -9 * side); return [home.x + dx, home.z + dz] }),
  }
}

// ---- protected zones and seed avoid boxes ------------------------------------------------------------------------------

/**
 * PARSE protectzone-01's file (version 1, `hashed_seed` binds it to one world) -> { ok, zones: [{ id, box: [x0,y0,z0,x1,y1,z1] }],
 * why }. Pure. `ok` false = UNREADABLE (malformed, wrong version): the caller keeps the last good list or suspends fitting.
 * Another world's file is ok with no zones (it is not this world's). A malformed zone is dropped and named; a box wider than
 * 1,024 is refused as a typo (protectzone-01's rules).
 */
export function parseZones (json, world) {
  if (json == null) return { ok: true, zones: [], why: 'absent' }
  if (typeof json !== 'object' || Array.isArray(json)) return { ok: false, zones: [], why: 'not an object' }
  if (json.version !== 1) return { ok: false, zones: [], why: `version ${json.version}` }
  if (world != null && json.hashed_seed != null && String(json.hashed_seed) !== String(world)) return { ok: true, zones: [], why: 'another world' }
  if (!Array.isArray(json.zones)) return { ok: false, zones: [], why: 'no zones list' }
  const zones = [], dropped = []
  for (const z of json.zones) {
    const b = z?.box
    if (!Array.isArray(b) || b.length !== 6 || !b.every(Number.isFinite) || b[3] < b[0] || b[4] < b[1] || b[5] < b[2] ||
        b[3] - b[0] > 1024 || b[5] - b[2] > 1024) { dropped.push(String(z?.id ?? '?')); continue }
    zones.push({ id: String(z.id ?? `zone${zones.length}`), box: b.map(Math.floor) })
  }
  if (json.zones.length && !zones.length) return { ok: false, zones: [], why: `every zone malformed (${dropped.join(',')})` }
  return { ok: true, zones, why: dropped.length ? `dropped ${dropped.join(',')}` : 'ok' }
}
/** A seed's avoid boxes ([x0,y0,z0,x1,y1,z1] or { box }) -> zones. Pure; malformed entries dropped. */
export function avoidZones (avoid = []) {
  const out = []
  for (const a of (Array.isArray(avoid) ? avoid : [])) {
    const b = Array.isArray(a) ? a : a?.box
    if (Array.isArray(b) && b.length === 6 && b.every(Number.isFinite)) out.push({ id: String(a?.id ?? 'avoid'), box: b.map(Math.floor) })
  }
  return out
}
/** Does the 3-D box [x0,y0,z0,x1,y1,z1] meet any zone? Pure. */
export function boxMeetsZones (box, zones = []) {
  return zones.find(z => box[0] <= z.box[3] && box[3] >= z.box[0] && box[1] <= z.box[4] && box[4] >= z.box[1] && box[2] <= z.box[5] && box[5] >= z.box[2]) ?? null
}
export const cellInZones = (x, y, z, zones = []) => boxMeetsZones([x, y, z, x, y, z], zones)

/**
 * THE SEED (the showcase's town-site.json; build spec 1.8) -> { ok, use: { orientation?, s?, avoid }, why }. Pure. The file
 * must name this home ([x, y, z] or {x,y,z}) and, when it carries `hashed_seed`, this world; else it is ignored (ok, no use).
 */
export function parseSeed (json, { home, world = null } = {}) {
  if (json == null) return { ok: true, use: null, why: 'absent' }
  if (typeof json !== 'object' || Array.isArray(json)) return { ok: false, use: null, why: 'not an object' }
  const h = Array.isArray(json.home) ? { x: json.home[0], y: json.home[1], z: json.home[2] } : json.home
  if (!h || h.x !== home?.x || h.y !== home?.y || h.z !== home?.z) return { ok: true, use: null, why: 'another home' }
  if (world != null && json.hashed_seed != null && String(json.hashed_seed) !== String(world)) return { ok: true, use: null, why: 'another world' }
  const tp = json.town_plan ?? {}
  if (tp.template != null && tp.template !== TEMPLATE) return { ok: true, use: null, why: `template ${tp.template}` }
  const use = { avoid: avoidZones(tp.avoid) }
  if (ORIENTS.includes(tp.orientation)) use.orientation = tp.orientation
  if (Number.isSafeInteger(tp.s)) use.s = tp.s
  return { ok: true, use, why: 'ok' }
}

// ---- reading the ground ------------------------------------------------------------------------------------------------

/**
 * THE GROUND LEVEL OF A COLUMN -> y of its top solid non-tree block within home.y +- FIT_DY with a passable or tree cell
 * above, null if unknown (a null read in the scanned span). Pure.
 */
export function groundY (read, x, z, hy) {
  for (let y = hy + FIT_DY; y >= hy - FIT_DY; y--) {
    const b = read(x, y, z)
    if (!b) return null
    if (isSolid(b) && !isTreeish(b)) {
      const above = read(x, y + 1, z)
      if (!above) return null
      if (isPassable(above) || isTreeish(above) || PLACEABLE_INTO.has(nm(above)) || isLiquid(above)) return y
    }
  }
  return undefined   // read, but no ground in the span (a void or a pillar of water)
}

/**
 * WHY THIS CELL IS NOT READY for a container or station at y = s + 1 -> a reason, or null (READY). Pure (build spec 1.5).
 *   ctx.zones   protected zones + avoid boxes;  ctx.home
 *   ctx.planned Set of "x,y,z" of this plan's own cells (their furniture is no obstacle to a neighbour: design workshop
 *               stations stand side by side -- Codex spec r1 P1)
 *   ctx.wells   [{x,y,z}] well caps / plinth cells (no cell within 2);  ctx.farm Set of "x,z" tree-farm cells (none within 2)
 */
export function readyCell (read, [x, y, z], ctx = {}, kind = null) {
  const s = y - 1
  const home = ctx.home
  // the bot's own well rules (skills.mjs supplies them: chestfull wellKeepout for a chest, stationRefusalAt for a station;
  // both for a cell whose kind is not decided yet) and the cells no plan cell may take (plinth shells and stairs)
  if (ctx.solid?.has(k3(x, y, z))) return 'a well or stair cell'
  if (typeof ctx.cellForbid === 'function') { const why = ctx.cellForbid([x, y, z], kind); if (why) return why }
  if (home && x === home.x && z === home.z) return 'the home column'
  if (cellInZones(x, y, z, ctx.zones) || cellInZones(x, s, z, ctx.zones)) return 'protected zone'
  const floor = read(x, s, z), cell = read(x, y, z), lid = read(x, y + 1, z)
  if (!floor || !cell || !lid) return 'unknown'
  if (!isSolidFull(floor)) return `floor ${nm(floor)}`
  if (!replaceableCell(cell)) return `cell ${nm(cell)}${nm(cell) === 'snow' ? `:${cell.props?.layers ?? '?'}` : ''}`
  // the cell above: never liquid, never a lid (lidrule: leaves and glass open; a full solid, mud and soul sand do not)
  if (isLiquid(lid) || lidBlocks(lid)) return `lid ${nm(lid)}`
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dy = -1; dy <= 1; dy++) {
        const b = read(x + dx, y + dy, z + dz)
        if (!b) return 'unknown'
        if (isLiquid(b)) return 'liquid within 1'
        if (dx === 0 && dz === 0) continue
        if (isFurniture(b) && !(ctx.planned?.has(k3(x + dx, y + dy, z + dz)))) return `${nm(b)} within 1`
        // a SAPLING grows into the cell; a standing trunk or leaves do not (showcase ground 10-21: a spruce beside a cell)
        if (/_sapling$/.test(nm(b))) return `${nm(b)} within 1`
      }
    }
  }
  // a junk well's cap: a raised (plinth) well's shell is cap +- 2, so its footprint + 1 is Chebyshev 3 (Claude spec r1 P1)
  for (const w of ctx.wells ?? []) if (Math.max(Math.abs(w.x - x), Math.abs(w.z - z)) <= 3 && Math.abs((w.y ?? y) - y) <= 6) return 'a well cap within 3'
  if (ctx.farm) for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) if (ctx.farm.has(`${x + dx},${z + dz}`)) return 'a tree-farm cell within 2'
  return null
}

// ---- joint access (build spec 1.5) -------------------------------------------------------------------------------------

/**
 * WHERE A BOT CAN WALK FROM HOME -> Set of feet keys "x,y,z". Pure. A node: floor solid, feet and head passable and dry, not a
 * `filled` cell (a candidate container/station is solid for the walk); 4-neighbour steps of dy -1, 0, +1 (an up-step needs
 * head room above the start); inside Chebyshev `radius` of home. Starts at home's feet cell, or the nearest node within 2.
 * Unknown cells are not walkable.
 */
export function walkable (read, home, filled = new Set(), radius = FIT_R) {
  const isNode = (x, y, z) => {
    if (filled.has(k3(x, y, z)) || filled.has(k3(x, y + 1, z))) return false
    const f = read(x, y - 1, z), a = read(x, y, z), h = read(x, y + 1, z)
    return !!f && !!a && !!h && (isSolid(f) || filled.has(k3(x, y - 1, z))) && isPassable(a) && isPassable(h)
  }
  let start = null
  outer: for (let r = 0; r <= 2; r++) {
    for (let dy of [0, 1, -1, 2, -2]) {
      for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue
        if (isNode(home.x + dx, home.y + dy, home.z + dz)) { start = [home.x + dx, home.y + dy, home.z + dz]; break outer }
      }
    }
  }
  const seen = new Set()
  if (!start) return seen
  const q = [start]; seen.add(kOf(start))
  while (q.length) {
    const [x, y, z] = q.shift()
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz
      if (Math.max(Math.abs(nx - home.x), Math.abs(nz - home.z)) > radius) continue
      for (const dy of [0, 1, -1]) {
        const ny = y + dy
        const key = k3(nx, ny, nz)
        if (seen.has(key)) continue
        if (dy === 1) { const hb = read(x, y + 2, z); if (!isPassable(hb) || filled.has(k3(x, y + 2, z))) continue }
        if (dy === -1) { const hb = read(nx, y + 1, nz); if (!isPassable(hb) || filled.has(k3(nx, y + 1, nz))) continue }
        if (!isNode(nx, ny, nz)) continue
        seen.add(key); q.push([nx, ny, nz])
        break
      }
    }
  }
  return seen
}
/** A reachable feet cell from which the block at `at` can be used -> [x,y,z] | null. Pure. Prefers `prefer` (the plan's stand). */
export function standFor (reach, at, prefer = null) {
  if (prefer && reach.has(kOf(prefer)) && within(prefer, at)) return prefer
  let best = null, bd = Infinity
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (const dy of [0, -1, 1]) {
    if (!dx && !dz) continue
    const f = [at[0] + dx, at[1] + dy, at[2] + dz]
    if (!reach.has(kOf(f)) || !within(f, at)) continue
    const d = Math.abs(dx) + Math.abs(dz) + Math.abs(dy) * 0.5
    if (d < bd) { bd = d; best = f }
  }
  return best
}
const within = (f, at) => Math.hypot(f[0] + 0.5 - (at[0] + 0.5), f[1] + 1.62 - (at[1] + 0.5), f[2] + 0.5 - (at[2] + 0.5)) <= REACH
/**
 * JOINT ACCESS -> { ok: [cell], dropped: [{ cell, why }], reach }. Pure. With EVERY kept cell filled, each must keep a reachable
 * stand; one that loses it is dropped and the walk repeats (bounded). `existing` (retrofit: town containers and tables) must
 * each keep a stand if they had one before -- a candidate set that cuts one off is refused whole (`cuts`).
 */
export function jointAccess (read, home, cells = [], { existing = [], radius = FIT_R, solid = null } = {}) {
  let keep = cells.slice()
  const dropped = []
  const base = solid instanceof Set ? solid : new Set()
  const before = existing.length ? walkable(read, home, base, radius) : null
  const hadStand = before ? existing.filter(e => standFor(before, e)) : []
  for (let pass = 0; pass <= cells.length; pass++) {
    const filled = new Set([...base, ...keep.map(c => kOf(c.at))])
    const reach = walkable(read, home, filled, radius)
    const lost = keep.filter(c => !standFor(reach, c.at, c.stand))
    const cut = hadStand.filter(e => !standFor(reach, e))
    if (!lost.length && !cut.length) return { ok: keep.map(c => ({ ...c, stand: standFor(reach, c.at, c.stand) })), dropped, reach, cuts: [] }
    if (cut.length && !lost.length) return { ok: [], dropped: [...dropped, ...keep.map(c => ({ cell: c, why: 'cuts off an existing container' }))], reach, cuts: cut }
    for (const c of lost) dropped.push({ cell: c, why: 'no reachable stand with every cell filled' })
    const lostSet = new Set(lost.map(c => kOf(c.at)))
    keep = keep.filter(c => !lostSet.has(kOf(c.at)))
  }
  return { ok: [], dropped, reach: new Set(), cuts: [] }
}

// ---- the fits ------------------------------------------------------------------------------------------------------------

/** Read every column in Chebyshev FIT_R of home -> { ground: Map "x,z" -> y|undefined, unknown: n }. Pure. */
export function readGround (read, home) {
  const ground = new Map()
  let unknown = 0
  for (let dx = -FIT_R; dx <= FIT_R; dx++) for (let dz = -FIT_R; dz <= FIT_R; dz++) {
    const g = groundY(read, home.x + dx, home.z + dz, home.y)
    if (g === null) unknown++
    ground.set(`${home.x + dx},${home.z + dz}`, g)
  }
  return { ground, unknown }
}
const modeLow = ys => {
  const c = new Map()
  for (const y of ys) if (Number.isFinite(y)) c.set(y, (c.get(y) ?? 0) + 1)
  return [...c.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? null
}
/** The storehouse pad's columns hold no TERRAIN above s (a later wall needs no dig of town ground) -> blocking cell count. */
function padBlocking (read, box, s) {
  let n = 0
  for (let x = box[0]; x <= box[2]; x++) for (let z = box[1]; z <= box[3]; z++) for (let y = s + 1; y <= s + 3; y++) { const b = read(x, y, z); if (!b || isTerrain(b)) n++ }
  return n
}

/**
 * THE GREENFIELD FIT (design 4.5) -> { fit, tried, why }. Pure. For each orientation E, S, W, N and workshop side +1, -1: s is
 * the most common ground level of the store pad (ties lower); the chest and station cells are judged READY; joint access
 * keeps those that stay reachable with all filled. A fit QUALIFIES when the first 4 chests (fill order) and stations 0 and 1
 * are kept. The best: most kept cells, then a clear pad, then E, S, W, N, +1, -1. A seed's orientation/s are taken when that
 * fit qualifies.
 */
export function fitGreenfield (read, home, { zones = [], wells = [], farm = null, seed = null, existing = [], solid = null, cellForbid = null } = {}) {
  const tried = []
  for (const orient of ORIENTS) {
    for (const side of [1, -1]) {
      const g0 = ring1(home, 0, orient, side)
      const pad = []
      for (let x = g0.storeBox[0]; x <= g0.storeBox[2]; x++) for (let z = g0.storeBox[1]; z <= g0.storeBox[3]; z++) pad.push(groundY(read, x, z, home.y))
      if (pad.some(y => y === null)) return { fit: null, tried, why: 'unknown' }
      const s = (seed?.s != null && seed?.orientation === orient) ? seed.s : modeLow(pad)
      if (s == null) { tried.push({ orient, side, why: 'no ground' }); continue }
      const g = ring1(home, s, orient, side)
      const planned = new Set([...g.cells, ...g.stations].map(c => kOf(c.at)))
      const ctx = { zones, home, planned, wells, farm, solid, cellForbid }
      const ready = [], unready = {}
      for (const c of [...g.cells, ...g.stations]) {
        const why = readyCell(read, c.at, ctx, c.kind)
        if (why === 'unknown') return { fit: null, tried, why: 'unknown' }
        if (why) unready[kOf(c.at)] = why; else ready.push(c)
      }
      const ja0 = jointAccess(read, home, ready, { existing, solid })
      // a stand within 3 of a well cap, or one the bot's own rule refuses, is no stand (Claude spec r2 P2): its cell is dropped
      const badStand = c => !c.stand || (wells ?? []).some(w => Math.max(Math.abs(w.x - c.stand[0]), Math.abs(w.z - c.stand[2])) <= 3) ||
        (typeof cellForbid === 'function' && !!cellForbid(c.stand, 'stand'))
      const ja = { ...ja0, ok: ja0.ok.filter(c => !badStand(c)), dropped: [...ja0.dropped, ...ja0.ok.filter(badStand).map(c => ({ cell: c, why: 'its stand is a well cell' }))] }
      const okKeys = new Set(ja.ok.map(c => kOf(c.at)))
      // QUALIFIES: 4 chest cells and stations 0 and 1 kept (any 4: found fills the next READY cell in fill order, so an unready
      // overflow cell costs nothing -- the showcase ground, 10-21, had its S fit's overflow cell one block low)
      const qualifies = g.cells.filter(c => okKeys.has(kOf(c.at))).length >= 4 && g.stations.slice(0, 2).every(c => okKeys.has(kOf(c.at)))
      const blocking = padBlocking(read, g.storeBox, s)
      tried.push({ orient, side, s, kept: ja.ok.length, qualifies, blocking, unready, ja, g })
    }
  }
  const q = tried.filter(t => t.qualifies)
  if (!q.length) return { fit: null, tried, why: 'no qualifying orientation' }
  const seeded = seed?.orientation ? q.find(t => t.orient === seed.orientation && t.side === 1) ?? q.find(t => t.orient === seed.orientation) : null
  const order = (a, b) => (b.kept - a.kept) || ((a.blocking ? 1 : 0) - (b.blocking ? 1 : 0)) || (ORIENTS.indexOf(a.orient) - ORIENTS.indexOf(b.orient)) || (b.side - a.side)
  const best = seeded ?? q.slice().sort(order)[0]
  return { fit: best, tried, why: seeded ? 'seed' : 'best' }
}

/**
 * THE ANNEX (design 4.5 step 2) -> { cells: [{ at, kind, role }], why }. Pure. Cells with Chebyshev >= 7 inside the town
 * circle, off `keepout(x, z)`, ring by ring then x then z; READY at the most common READY height; no two chests sharing a
 * side; joint access. Roles: the first is the workshop table's, then up to 4 store cells, then one furnace.
 */
export function fitAnnex (read, home, { zones = [], wells = [], farm = null, keepout = () => false, solid = null, cellForbid = null } = {}) {
  const cand = []
  for (let r = 7; r <= STORAGE_R; r++) {
    const ring = []
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) if (Math.max(Math.abs(dx), Math.abs(dz)) === r) ring.push([home.x + dx, home.z + dz])
    ring.sort((a, b) => a[0] - b[0] || a[1] - b[1])
    for (const [x, z] of ring) {
      if (Math.hypot(x - home.x, z - home.z) > STORAGE_R || keepout(x, z)) continue
      const gy = groundY(read, x, z, home.y)
      if (gy === null) return { cells: [], why: 'unknown' }
      if (gy === undefined || Math.abs(gy + 1 - home.y) > TOWN_DY) continue
      cand.push([x, gy + 1, z])
    }
  }
  const ctx0 = { zones, home, planned: new Set(), wells, farm, solid, cellForbid }
  // the kind is not decided yet: the strictest rules (a chest's AND a station's) for every candidate
  const ready = cand.filter(at => !readyCell(read, at, ctx0, 'chest') && !readyCell(read, at, ctx0, 'crafting_table'))
  const y = modeLow(ready.map(a => a[1]))
  if (y == null) return { cells: [], why: 'no READY cell' }
  const level = ready.filter(a => a[1] === y)
  // roles jointly, the table first; chests never side by side; the furnace last
  const picked = []
  const chestNear = at => picked.some(p => p.kind === 'chest' && Math.abs(p.at[0] - at[0]) + Math.abs(p.at[2] - at[2]) === 1 && p.at[1] === at[1])
  for (const at of level) {
    const nStore = picked.filter(p => p.kind === 'chest').length
    const want = !picked.length ? 'crafting_table' : nStore < 4 ? 'chest' : !picked.some(p => p.kind === 'furnace') ? 'furnace' : null
    if (!want) break
    if (want === 'chest' && chestNear(at)) continue
    picked.push({ at, kind: want, stand: null })
  }
  if (!picked.length) return { cells: [], why: 'no READY cell' }
  const planned = new Set(picked.map(p => kOf(p.at)))
  const re = picked.filter(p => !readyCell(read, p.at, { ...ctx0, planned }, p.kind))
  const ja = jointAccess(read, home, re, { solid })
  // the table keeps priority: if it was dropped, the next kept cell becomes the table's
  let cells = ja.ok
  if (cells.length && !cells.some(c => c.kind === 'crafting_table')) cells = [{ ...cells[0], kind: 'crafting_table' }, ...cells.slice(1)]
  return { cells, why: cells.length ? null : 'no accessible READY cell' }
}

/**
 * THE RETROFIT WORKSHOP (design 6.1.4) -> { strip: { size, stations: [{at, kind, stand}], box } | null, why }. Pure. The nearest
 * free strip: 5x3, else 5x2, else 4x2; station row along x or z; every station READY at its row's level, 7 <= Chebyshev <= 15;
 * joint access with the existing containers and tables (none loses its last reachable stand).
 */
export function fitRetrofitWorkshop (read, home, { zones = [], wells = [], farm = null, existing = [], keepout = () => false, solid = null, cellForbid = null } = {}) {
  const sizes = [{ n: 5, rows: 3, id: '5x3' }, { n: 5, rows: 2, id: '5x2' }, { n: 4, rows: 2, id: '4x2' }]
  for (const sz of sizes) {
    const cands = []
    for (let dx = -15; dx <= 15; dx++) for (let dz = -15; dz <= 15; dz++) {
      for (const along of ['x', 'z']) {
        const cells = []
        for (let i = 0; i < sz.n; i++) cells.push(along === 'x' ? [home.x + dx + i, home.z + dz] : [home.x + dx, home.z + dz + i])
        if (cells.some(([x, z]) => { const d = Math.max(Math.abs(x - home.x), Math.abs(z - home.z)); return d < 7 || d > 15 || Math.hypot(x - home.x, z - home.z) > STORAGE_R || keepout(x, z) })) continue
        const cx = cells.reduce((t, c) => t + c[0], 0) / cells.length, cz = cells.reduce((t, c) => t + c[1], 0) / cells.length
        // the stand row toward home (5x2/4x2), or both sides (5x3)
        const toward = along === 'x' ? Math.sign(home.z - (home.z + dz)) || 1 : Math.sign(home.x - (home.x + dx)) || 1
        cands.push({ cells, along, toward, d: Math.hypot(cx - home.x, cz - home.z), dx, dz })
      }
    }
    cands.sort((a, b) => a.d - b.d || a.dx - b.dx || a.dz - b.dz || (a.along === 'x' ? -1 : 1))
    for (const c of cands) {
      const gys = c.cells.map(([x, z]) => groundY(read, x, z, home.y))
      if (gys.some(g => g === null)) return { strip: null, why: 'unknown' }
      if (gys.some(g => g === undefined) || new Set(gys).size !== 1) continue
      const y = gys[0] + 1
      if (Math.abs(y - home.y) > TOWN_DY) continue
      const off = (x, z, k) => c.along === 'x' ? [x, y, z + k] : [x + k, y, z]
      const stations = c.cells.map(([x, z], i) => ({ at: [x, y, z], kind: STATION_KINDS[i], stand: off(x, z, c.toward) }))
      // every station AND stand inside the town circle (Claude spec r1 P2: a corner strip left inTown)
      if (stations.some(st => [st.at, st.stand].some(a => Math.hypot(a[0] - home.x, a[2] - home.z) > STORAGE_R))) continue
      const planned = new Set(stations.map(s => kOf(s.at)))
      const ctx = { zones, home, planned, wells, farm, solid, cellForbid }
      if (stations.some(s => readyCell(read, s.at, ctx, s.kind))) continue
      // a stand is a station's access: never a well or stair cell, never within 3 of a cap, never refused by the bot's own rule
      if (stations.some(st => solid?.has(kOf(st.stand)) || (wells ?? []).some(w => Math.max(Math.abs(w.x - st.stand[0]), Math.abs(w.z - st.stand[2])) <= 3) ||
        (typeof cellForbid === 'function' && cellForbid(st.stand, 'stand')))) continue
      // the stand rows must be walkable now (feet at the station row's level)
      const rows = sz.rows === 3 ? [c.toward, -c.toward] : [c.toward]
      if (rows.some(k => c.cells.some(([x, z]) => { const [fx, fy, fz] = off(x, z, k); return !isPassable(read(fx, fy, fz)) || !isPassable(read(fx, fy + 1, fz)) || !isSolid(read(fx, fy - 1, fz)) }))) continue
      const ja = jointAccess(read, home, stations, { existing, solid })
      if (ja.ok.length !== stations.length) continue
      const xs = c.cells.map(a => a[0]), zs = c.cells.map(a => a[1])
      const pad = sz.rows === 3 ? 1 : 0
      const box = c.along === 'x'
        ? [Math.min(...xs), Math.min(...zs) - (c.toward < 0 || pad ? 1 : 0), Math.max(...xs), Math.max(...zs) + (c.toward > 0 || pad ? 1 : 0)]
        : [Math.min(...xs) - (c.toward < 0 || pad ? 1 : 0), Math.min(...zs), Math.max(...xs) + (c.toward > 0 || pad ? 1 : 0), Math.max(...zs)]
      return { strip: { size: sz.id, stations: ja.ok, box, y: y - 1 }, why: null }
    }
  }
  return { strip: null, why: 'no free strip' }
}

// ---- sectors -------------------------------------------------------------------------------------------------------------

export const SECTORS = Object.freeze(['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'])
const SECTOR_VEC = { E: [1, 0], SE: [1, 1], S: [0, 1], SW: [-1, 1], W: [-1, 0], NW: [-1, -1], N: [0, -1], NE: [1, -1] }
/** The 45-degree sector of (x, z) seen from home. Pure. */
export function sectorOf (home, x, z) {
  const a = Math.atan2(z - home.z, x - home.x)
  const i = ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8
  return SECTORS[i]
}
/** OUTER-PLOT EXTENTS for the zone test (build spec 1.4): centre distance d along the sector, half-width r, y span. */
export const OUTER = Object.freeze({
  shaft: { d: 19, r: 26, y: s => [-64, s + 3], prefer: ['NE', 'SE', 'SW', 'NW', 'E', 'S', 'W', 'N'] },
  monument: { d: 51, r: 27, y: s => [s - 4, s + 40], prefer: ['NW', 'NE', 'SW', 'SE', 'W', 'N', 'E', 'S'] },
  pavilion: { d: 33, r: 17, y: s => [s - 4, s + 16], prefer: null },
  hall: { d: 33, r: 17, y: s => [s - 4, s + 16], prefer: null },
  gate: { d: 44, r: 3, y: s => [s - 4, s + 6], prefer: null },
})
export function sectorExtent (home, s, kind, sector) {
  const o = OUTER[kind], [vx, vz] = SECTOR_VEC[sector]
  const n = Math.hypot(vx, vz), cx = home.x + Math.round(vx / n * o.d), cz = home.z + Math.round(vz / n * o.d)
  const [y0, y1] = o.y(s)
  return [cx - o.r, y0, cz - o.r, cx + o.r, y1, cz + o.r]
}
/**
 * THE OUTER PLOTS' SECTORS -> [{ id, kind, sector | null, state }]. Pure. In order gate, shaft, monument, pavilion, hall; each
 * takes the first sector of its preference not taken (the store's, the well's and the farm's cardinals are taken for the
 * gate) and whose extent meets no zone. `fixed` (retrofit Z0/M0 data) pins a kind's sector when it meets no zone.
 */
export function assignOuter (home, s, { taken = [], zones = [], gateOpen = null, fixed = {} } = {}) {
  const used = new Set(taken)
  const out = []
  const free = (kind, sec) => !used.has(sec) && !boxMeetsZones(sectorExtent(home, s, kind, sec), zones)
  const take = (id, kind, prefs) => {
    const sec = (fixed[kind] && free(kind, fixed[kind])) ? fixed[kind] : prefs.find(p => free(kind, p)) ?? null
    if (sec) used.add(sec)
    out.push({ id, kind, sector: sec, state: sec ? 'planned' : 'unsited' })
  }
  const cards = ['S', 'W', 'N', 'E']
  const gatePrefs = cards.slice().sort((a, b) => ((gateOpen?.[b] ?? 0) - (gateOpen?.[a] ?? 0)) || cards.indexOf(a) - cards.indexOf(b))
  take('gate', 'gate', gatePrefs)
  take('shaft', 'shaft', OUTER.shaft.prefer)
  take('monument', 'monument', OUTER.monument.prefer)
  const rest = [...cards, 'NE', 'SE', 'SW', 'NW']
  take('pavilion', 'pavilion', rest)
  take('hall', 'hall', rest)
  return out
}
/** OPEN columns per cardinal in the gate band (d 22-44): dry, not a tree, loaded. Pure. */
export function gateOpenness (read, home) {
  const out = {}
  for (const sec of ['S', 'W', 'N', 'E']) {
    const [vx, vz] = SECTOR_VEC[sec]
    let n = 0
    for (let d = 22; d <= 44; d += 2) for (let w = -4; w <= 4; w += 2) {
      const x = home.x + vx * d + (vz ? w : 0), z = home.z + vz * d + (vx ? w : 0)
      const gy = groundY(read, x, z, home.y)
      if (gy == null) continue
      const above = read(x, gy + 1, z)
      if (above && !isTreeish(above) && !isLiquid(above) && !isLiquid(read(x, gy, z))) n++
    }
    out[sec] = n
  }
  return out
}

// ---- paths ---------------------------------------------------------------------------------------------------------------

/** A 2-wide axis segment from the core's edge (d 7) out to distance `d1` along a cardinal. Pure. */
export function spoke (home, card, d1) {
  const [vx, vz] = SECTOR_VEC[card]
  if (vx) { const xa = home.x + vx * 7, xb = home.x + vx * d1; return [Math.min(xa, xb), home.z, Math.max(xa, xb), home.z + 1] }
  const za = home.z + vz * 7, zb = home.z + vz * d1; return [home.x, Math.min(za, zb), home.x + 1, Math.max(za, zb)]
}
export const onSeg = (seg, x, z) => x >= seg[0] && x <= seg[2] && z >= seg[1] && z <= seg[3]
/** Does a segment come within Chebyshev 3 of a well cap (its footprint + 1)? Pure. */
export const segNearCap = (seg, cap) => cap.x >= seg[0] - 3 && cap.x <= seg[2] + 3 && cap.z >= seg[1] - 3 && cap.z <= seg[3] + 3
/**
 * THE FARM'S COMPOSTER CELL (build spec 1.4) -> [x, y, z] | null. Pure. The first cell of the farm's inner edge row that passes
 * the composter's own siteRefusal and is off every path and keep-out box + 1.
 */
export function farmComposter (read, home, edge = [], { soft = () => false, zones = [] } = {}) {
  for (const [x, z] of edge) {
    if (soft(x, z)) continue
    const gy = groundY(read, x, z, home.y)
    if (gy == null) continue
    const site = { x, y: gy + 1, z }
    if (cellInZones(x, gy + 1, z, zones)) continue
    if (!composterSiteRefusal(read, site, home)) return [x, gy + 1, z]
  }
  return null
}

// ---- the plan bodies -------------------------------------------------------------------------------------------------------

const cellsOut = cs => cs.map(c => ({ at: c.at, kind: c.kind, stand: c.stand ?? null, role: null, group: null, state: 'free' }))
const stationsOut = cs => cs.map(c => ({ at: c.at, kind: c.kind, stand: c.stand ?? null, state: 'free' }))

/**
 * A GREENFIELD PLAN BODY from a fit (or the annex) -> the body planstore.publishPlan writes. Pure.
 */
export function greenfieldBody (home, fit, { zones = [], seedInfo = null, gateOpen = null, annex = null, zoneInfo = null } = {}) {
  if (fit) {
    const g = fit.g, o = fit.orient, s = fit.s
    const okKeys = new Set(fit.ja.ok.map(c => kOf(c.at)))
    const standOf = new Map(fit.ja.ok.map(c => [kOf(c.at), c.stand]))
    const withStand = c => ({ ...c, stand: standOf.get(kOf(c.at)) ?? c.stand })
    const store = { id: 'store', kind: 'storehouse', box: g.storeBox, y: s, door: g.door, state: 'planned', keepout: true,
      building: fit.blocking ? `needs_terrain:${fit.blocking}` : 'clear', cells: cellsOut(g.cells.map(withStand)) }
    store.cells.forEach((c, i) => { c.ready = okKeys.has(kOf(c.at)); if (i === 0) c.role = 'overflow' })
    const work = { id: 'work', kind: 'workshop', box: g.workBox, y: s, state: 'planned', keepout: true, size: '5x3', stations: stationsOut(g.stations.map(withStand)) }
    work.stations.forEach(c => { c.ready = okKeys.has(kOf(c.at)) })
    const taken = [o, g.wellSector, g.farmSector]
    const outer = assignOuter(home, s, { taken, zones, gateOpen })
    const gate = outer.find(p => p.id === 'gate')
    const paths = [
      { id: 'p-well', to: 'well', width: 2, seg: spoke(home, g.wellSector, 9), state: 'planned' },
      { id: 'p-farm', to: 'farm', width: 2, seg: spoke(home, g.farmSector, 9), state: 'planned' },
      ...(gate?.sector ? [{ id: 'p-gate', to: 'gate', width: 2, seg: spoke(home, gate.sector, 44), state: 'planned' }] : []),
    ]
    return {
      template: TEMPLATE, home: { ...home }, s, mode: 'greenfield', orientation: o, workSide: fit.side, seed: seedInfo,
      plots: [
        { id: 'core', kind: 'plaza', box: g.core, y: s, state: 'planned', keepout: true },
        store, work,
        { id: 'well', kind: 'well', sector: g.wellSector, ref: null, state: 'planned' },
        { id: 'farm', kind: 'farm', sector: g.farmSector, composter: fit.composter ?? null, state: 'planned' },
        ...outer,
      ],
      paths,
      groups: { v: 1, status: 'greenfield', homes: {}, overflow: [], drain: [], pending: [] },
      zones: zoneInfo ?? { n: zones.length },
    }
  }
  // the annex (or nothing at all)
  const cells = annex?.cells ?? []
  const table = cells.find(c => c.kind === 'crafting_table')
  const chests = cells.filter(c => c.kind === 'chest')
  const furnace = cells.find(c => c.kind === 'furnace')
  const s = (table ?? cells[0])?.at?.[1] != null ? (table ?? cells[0]).at[1] - 1 : home.y - 1
  const storeCells = cellsOut(chests); if (storeCells[0]) storeCells[0].role = 'overflow'
  const st = [table, furnace].filter(Boolean)
  const outer = assignOuter(home, s, { taken: [], zones, gateOpen })
  return {
    template: TEMPLATE, home: { ...home }, s, mode: 'greenfield', orientation: null, seed: seedInfo,
    plots: [
      { id: 'core', kind: 'plaza', box: [home.x - 6, home.z - 6, home.x + 6, home.z + 6], y: s, state: 'planned', keepout: false },
      chests.length ? { id: 'store', kind: 'annex', state: 'planned', keepout: true, cells: storeCells } : { id: 'store', kind: 'unplaced', state: 'planned', keepout: false, cells: [] },
      ...(st.length ? [{ id: 'work', kind: 'workshop', size: 'annex', state: 'planned', keepout: true, stations: stationsOut(st) }] : []),
      { id: 'well', kind: 'well', sector: null, ref: null, state: 'planned' },
      { id: 'farm', kind: 'farm', sector: null, composter: null, state: 'planned' },
      ...outer,
    ],
    paths: [],
    groups: { v: 1, status: 'greenfield', homes: {}, overflow: [], drain: [], pending: [] },
    zones: zoneInfo ?? { n: zones.length },
  }
}

/**
 * A RETROFIT PLAN BODY -> the body. Pure. `containers` = [{ k, halves, at: [x,y,z], obs: names|null }] (one per double chest);
 * `allocate` = townindex allocateHomes. Groups are allocated only when every container has an observation (a home is never
 * chosen from an index entry with none; stale and dirty counts are counts -- Codex spec r1 P2).
 */
export function retrofitBody (home, { strip = null, containers = [], allocate = null, wellCap = null, wellRef = null, composter = null,
                                         zones = [], gateOpen = null, fixed = {}, zoneInfo = null, seedInfo = null } = {}) {
  const s = home.y - 1
  const groups = groupsFor(home, containers, allocate)
  const wellSector = wellCap ? sectorCard(home, wellCap.x, wellCap.z) : null
  const farmSector = composter ? sectorCard(home, composter[0], composter[2]) : null
  const taken = [wellSector, farmSector].filter(Boolean)
  const outer = assignOuter(home, s, { taken, zones, gateOpen, fixed })
  const gate = outer.find(p => p.id === 'gate')
  // the well path stops 4 short of the cap's Chebyshev distance: never inside its footprint (cap +- 2) + 1 (Claude spec r1 P1)
  const capD = wellCap ? Math.max(Math.abs(wellCap.x - home.x), Math.abs(wellCap.z - home.z)) : 0
  const paths = [
    ...(wellSector && capD - 4 >= 7 ? [{ id: 'p-well', to: 'well', width: 2, seg: spoke(home, wellSector, capD - 4), state: 'planned' }] : []),
    ...(gate?.sector ? [{ id: 'p-gate', to: 'gate', width: 2, seg: spoke(home, gate.sector, 44), state: 'planned' }] : []),
  ].filter(pt => !wellCap || !segNearCap(pt.seg, wellCap))
  return {
    template: TEMPLATE, home: { ...home }, s, mode: 'retrofit', orientation: null, seed: seedInfo,
    plots: [
      { id: 'core', kind: 'plaza', box: [home.x - 6, home.z - 6, home.x + 6, home.z + 6], y: s, state: 'existing', keepout: false },
      { id: 'store', kind: 'cluster', state: 'existing', keepout: false, cells: [] },
      ...(strip ? [{ id: 'work', kind: 'workshop', box: strip.box, y: strip.y, size: strip.size, state: 'planned', keepout: true, stations: stationsOut(strip.stations) }] : []),
      { id: 'well', kind: 'well', sector: wellSector, ref: wellRef, state: wellCap ? 'existing' : 'planned' },
      { id: 'farm', kind: 'farm', sector: farmSector, composter: composter ?? null, state: composter ? 'existing' : 'planned' },
      ...outer,
    ],
    paths,
    groups,
    zones: zoneInfo ?? { n: zones.length },
  }
}
/** The cardinal (not 8-wind) of a point from home -- for sectors that name a side (well, farm). Pure. */
export function sectorCard (home, x, z) {
  const dx = x - home.x, dz = z - home.z
  return Math.abs(dx) >= Math.abs(dz) ? (dx >= 0 ? 'E' : 'W') : (dz >= 0 ? 'S' : 'N')
}
let groupOf = () => 'misc'
/** The item -> group map (townindex.mjs groupOfItem), installed by skills.mjs so this module stays free of the index. */
export function setGroupOf (fn) { if (typeof fn === 'function') groupOf = fn }
function groupStock (containers, g) {
  let n = 0
  for (const c of containers) for (const [name, v] of Object.entries(c.obs ?? {})) if (groupOf(name) === g) n += Number(v?.[0]) || 0
  return n
}
/** Retrofit groups -> the plan's `groups`. Pure. */
export function groupsFor (home, containers = [], allocate = null) {
  const unknown = containers.filter(c => !c.obs).length
  if (unknown || typeof allocate !== 'function') return { v: 1, status: 'waiting', homes: {}, overflow: [], drain: [], pending: [], unknown }
  const a = allocate(containers.map(c => ({ k: c.k, halves: c.halves, names: c.obs })), { home })
  const homes = Object.fromEntries(Object.entries(a.homes).filter(([, ks]) => ks.length))
  // a group with stock but no home (every container was taken): its items go to the overflow until one frees (design 6.1)
  const pending = Object.keys(a.capacity ?? {}).filter(g => !(homes[g]?.length) && groupStock(containers, g) > 0)
  return { v: 1, status: 'allocated', homes, overflow: a.overflow, drain: a.drain, pending }
}

// ---- keep-outs for the adopters (build spec 1.6): OUTSIDE, SOFT, BOX, and NEVER ------------------------------------------

const cellsOfPlot = p => [...(p?.cells ?? []), ...(p?.stations ?? [])]
const isCommittedCell = c => c?.state === 'reserved' || c?.state === 'placed' || Number.isFinite(c?.seenSince)
export const plotCommitted = p => cellsOfPlot(p).some(isCommittedCell)
const inBox1 = (b, x, z) => x >= b[0] - 1 && x <= b[2] + 1 && z >= b[1] - 1 && z <= b[3] + 1

/**
 * THE PLAN'S KEEP-OUTS -> { tier(x, y, z) -> 'never' | 'box' | 'soft' | null, softAt, boxAt, never, ... }. Pure.
 *   NEVER  every plan cell (any state) and every reserved or placed cell's stand (feet and head): no adopter, ever
 *   BOX    the box + 1 of a COMMITTED plot (and a committed annex's cells + 1): third and last
 *   SOFT   the box + 1 of an uncommitted keep-out plot, annex surroundings + 1, path segments: second
 *   null   OUTSIDE: first
 */
export function keepouts (plan) {
  const never = new Set()
  const box = [], soft = []
  for (const p of plan?.plots ?? []) {
    const committed = plotCommitted(p)
    for (const c of cellsOfPlot(p)) {
      never.add(kOf(c.at))
      if ((c.state === 'reserved' || c.state === 'placed') && Array.isArray(c.stand)) { never.add(kOf(c.stand)); never.add(k3(c.stand[0], c.stand[1] + 1, c.stand[2])) }
    }
    if (!p.keepout) continue
    const boxes = Array.isArray(p.box) ? [p.box] : cellsOfPlot(p).flatMap(c => [[c.at[0], c.at[2], c.at[0], c.at[2]], ...(Array.isArray(c.stand) ? [[c.stand[0], c.stand[2], c.stand[0], c.stand[2]]] : [])])
    ;(committed ? box : soft).push(...boxes)
  }
  const segs = (plan?.paths ?? []).map(p => p.seg).filter(Array.isArray)
  const boxAt = (x, z) => box.some(b => inBox1(b, x, z))
  const softAt = (x, z) => soft.some(b => inBox1(b, x, z)) || segs.some(sg => onSeg(sg, x, z))
  const isNever = (x, y, z) => never.has(k3(x, y, z))
  const tier = (x, y, z) => (isNever(x, y, z) ? 'never' : boxAt(x, z) ? 'box' : softAt(x, z) ? 'soft' : null)
  return { tier, never: isNever, boxAt, softAt, soft: softAt, boxes: box, softBoxes: soft, segs, neverCells: [...never].map(k => k.split(',').map(Number)) }
}
export const TIER_RANK = Object.freeze({ null: 0, soft: 1, box: 2, never: 3 })
/** The pass a tier is first allowed in: OUTSIDE 1, SOFT 2, BOX 3, NEVER never. Pure. */
export const tierAllowed = (tier, pass) => (tier === 'never' ? false : TIER_RANK[tier ?? 'null'] < pass)
/** The worst tier over a junk well's footprint (cap +- 2, feet and head levels). Pure. */
export function footprintTier (ko, cap) {
  let worst = null
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (const dy of [0, 1]) {
    const t = ko.tier(cap.x + dx, cap.y + dy, cap.z + dz)
    if (TIER_RANK[t ?? 'null'] > TIER_RANK[worst ?? 'null']) worst = t
  }
  return worst
}
/** Kept for the adopters' old call shape: 'hard' (never or box) | 'soft' | null. */
export function wellFootprintClass (ko, cap) {
  const t = footprintTier(ko, cap)
  return t === 'never' || t === 'box' ? 'hard' : t
}

/**
 * ACCESS (build spec 1.6): with `cells` filled (a candidate placement), does every committed plan cell and every existing
 * container/table/furnace that was reachable from home keep a reachable stand? -> { ok, cut: [[x,y,z]], ms }. Pure.
 */
export function accessKept (read, home, plan, cells = [], { existing = [], radius = FIT_R } = {}) {
  const t0 = Date.now()
  const committed = (plan?.plots ?? []).flatMap(cellsOfPlot).filter(c => c.state === 'placed' || c.state === 'reserved')
  const targets = [...committed.map(c => c.at), ...existing]
  if (!targets.length) return { ok: true, cut: [], ms: 0 }
  const filled0 = new Set(committed.filter(c => c.state === 'reserved').map(c => kOf(c.at)))
  const before = walkable(read, home, filled0, radius)
  const had = targets.filter(t => standFor(before, t))
  const filled1 = new Set([...filled0, ...cells.map(kOf)])
  const after = walkable(read, home, filled1, radius)
  const cut = had.filter(t => !standFor(after, t))
  return { ok: !cut.length, cut, ms: Date.now() - t0 }
}

// ---- the whole fit and the maintenance steps (build spec 1.5) -------------------------------------------------------------

/**
 * THE TOWN'S FIRST PLAN -> { body, mode, summary, why } (body null: no plan yet, `why` says why). Pure. ctx:
 *   containers [{ k, halves, at, obs }]  the town containers in inTown (one per double chest; obs = the index's last names)
 *   existing   [[x,y,z]]                 every container half, crafting table and furnace in the fit box (kept reachable)
 *   zones      [{ id, box }]             protected zones + seed avoid boxes
 *   wells      [{x,y,z}]                 every well cap and plinth cap;  farm  Set "x,z" of tree-farm record cells
 *   seed       parseSeed(...).use | null; seedInfo, zoneInfo  recorded in the plan
 *   allocate   townindex allocateHomes;  wellCap, wellRef, composter  (retrofit records)
 *   fixed      { monument, shaft } sectors (retrofit Z0/M0)
 */
export function fitTown (read, home, ctx = {}) {
  const { containers = [], existing = [], zones = [], wells = [], farm = null, seed = null, seedInfo = null, zoneInfo = null, solid = null, cellForbid = null } = ctx
  const gateOpen = gateOpenness(read, home)
  if (!containers.length) {
    const r = fitGreenfield(read, home, { zones, wells, farm, seed, existing, solid, cellForbid })
    if (r.why === 'unknown') return { body: null, mode: 'greenfield', why: 'unknown cells in the fit box' }
    if (r.fit) {
      const body0 = greenfieldBody(home, r.fit, { zones, seedInfo, gateOpen, zoneInfo })
      const ko = keepouts(body0)
      const composter = farmComposter(read, home, r.fit.g.farmEdge, { soft: (x, z) => ko.tier(x, home.y, z) !== null, zones })
      const body = greenfieldBody(home, { ...r.fit, composter }, { zones, seedInfo, gateOpen, zoneInfo })
      const kept = r.fit.ja.ok.length
      return { body, mode: 'greenfield', why: r.why, summary: { store: `sections:${body.plots[1].cells.length}`, work: '5x3', ready: `${kept}/12`, access: `${kept}/${kept + r.fit.ja.dropped.length}`, orient: r.fit.orient } }
    }
    const a = fitAnnex(read, home, { zones, wells, farm, solid, cellForbid })
    if (a.why === 'unknown') return { body: null, mode: 'greenfield', why: 'unknown cells in the annex scan' }
    const body = greenfieldBody(home, null, { zones, seedInfo, gateOpen, annex: a, zoneInfo })
    const store = body.plots.find(p => p.id === 'store')
    return { body, mode: 'greenfield', why: a.cells.length ? 'annex' : 'no READY cell', summary: { store: store.kind === 'annex' ? `annex:${store.cells.length}` : 'unplaced', work: a.cells.length ? 'annex' : 'none', ready: `${a.cells.length}`, access: `${a.cells.length}` } }
  }
  const w = fitRetrofitWorkshop(read, home, { zones, wells, farm, existing, solid, cellForbid })
  if (w.why === 'unknown') return { body: null, mode: 'retrofit', why: 'unknown cells in the workshop search' }
  const body = retrofitBody(home, { strip: w.strip, containers, allocate: ctx.allocate, wellCap: ctx.wellCap ?? null, wellRef: ctx.wellRef ?? null,
    composter: ctx.composter ?? null, zones, gateOpen, fixed: ctx.fixed ?? {}, zoneInfo, seedInfo })
  return { body, mode: 'retrofit', why: w.strip ? 'strip' : w.why, summary: { store: 'cluster', work: w.strip?.size ?? 'none', ready: w.strip ? `${w.strip.stations.length}` : '0', access: w.strip ? `${w.strip.stations.length}` : '0' } }
}

/** A cell's KIND is a family (build spec 1.2): chest = chest or trapped_chest; furnace in any lit state; table. */
const KIND_BLOCK = { chest: /^(chest|trapped_chest)$/, crafting_table: /^crafting_table$/, furnace: /^furnace$/ }
/** Does the block read as the cell's kind? -> true | false | null (unknown). Pure. */
export function readsKind (read, cell) {
  const b = read(cell.at[0], cell.at[1], cell.at[2])
  if (!b) return null
  return (KIND_BLOCK[cell.kind] ?? /^$/).test(nm(b))
}
/** The observation delay (planstore OBSERVE_MS, repeated here to keep this module free of the file module). */
export const OBSERVE_DELAY_MS = 10 * 60_000

/**
 * ONE MAINTENANCE STEP -> { body, op, why } | null (nothing to do). Pure; a clone of `plan` is changed. In order (build spec 1.5):
 *   (c) a reservation past until + 60 s: reads its kind -> `seenSince` (then `placed` 10 min later, its intent kept), reads
 *       anything else -> free + `expired`, unknown -> nothing;
 *   (d) the marks: a free cell reading its kind -> `seenSince`, matured -> `placed` (intent kept); a free marked cell reading
 *       otherwise -> cleared; a placed cell reading otherwise -> `missingSince`, matured -> free + `gone` (intent kept); a
 *       placed marked cell reading its kind -> cleared; unknown changes nothing;
 *   (a) retrofit `waiting` and nothing unknown -> allocate; (b) retrofit: a new container -> drain; a pending group -> the
 *       emptiest observed drain container. (Greenfield: an unassigned placed store cell is given a homeless group by the
 *       found slot itself -- found.mjs foundAssign, skills.mjs foundAssignHome -- not here.)
 * A reservation that has not expired is its holder's (only its holder touches it).
 */
export function maintainPlan (plan, read, { now = Date.now(), containers = null, allocate = null, margin = 60_000 } = {}) {
  if (!plan) return null
  const p = JSON.parse(JSON.stringify(plan))
  p.transitions = []
  const all = p.plots.flatMap(pl => [...(pl.cells ?? []), ...(pl.stations ?? [])])
  const matured = c => Number.isFinite(c.seenSince) && now >= c.seenSince + OBSERVE_DELAY_MS
  // (c) expired reservations
  for (const c of all) {
    if (c.state !== 'reserved' || !(now > Number(c.until) + margin)) continue
    const k = readsKind(read, c)
    if (k === null) continue
    if (k) {
      if (!Number.isFinite(c.seenSince)) { c.seenSince = now; return { body: p, op: 'seen', why: `${c.kind} at ${c.at.join(',')} (an expired reservation)` } }
      if (!matured(c)) continue
      c.state = 'placed'; delete c.seenSince; delete c.intentSet; c.observed = true
      return { body: p, op: 'observe', why: `${c.kind} at ${c.at.join(',')} (an expired reservation, read twice)` }
    }
    const at = c.at
    delete c.by; delete c.visit; delete c.until; delete c.seenSince
    c.state = 'free'
    // the intent the expired reservation SET goes with it (skills planReserve marks it); an older intent stays
    if (c.intentSet) { c.role = null; c.group = null }
    delete c.intentSet
    p.transitions.push({ at, why: 'expired' })
    return { body: p, op: 'expire', why: `${c.kind} at ${at.join(',')}` }
  }
  // (d) the marks
  for (const c of all) {
    if (c.state === 'free') {
      const k = readsKind(read, c)
      if (k === null) continue
      if (k && !Number.isFinite(c.seenSince)) { c.seenSince = now; return { body: p, op: 'seen', why: `${c.kind} at ${c.at.join(',')}` } }
      if (k && matured(c)) { c.state = 'placed'; delete c.seenSince; c.observed = true; return { body: p, op: 'observe', why: `${c.kind} at ${c.at.join(',')} (read twice)` } }
      if (!k && Number.isFinite(c.seenSince)) { delete c.seenSince; return { body: p, op: 'unseen', why: `${c.kind} at ${c.at.join(',')}` } }
    } else if (c.state === 'placed') {
      const k = readsKind(read, c)
      if (k === null) continue
      if (!k && !Number.isFinite(c.missingSince)) { c.missingSince = now; return { body: p, op: 'missing', why: `${c.kind} at ${c.at.join(',')}` } }
      if (!k && now >= c.missingSince + OBSERVE_DELAY_MS) {
        delete c.missingSince; delete c.observed; delete c.by; delete c.visit
        c.state = 'free'
        p.transitions.push({ at: c.at, why: 'gone' })
        return { body: p, op: 'gone', why: `${c.kind} at ${c.at.join(',')} (read empty twice)` }
      }
      if (k && Number.isFinite(c.missingSince)) { delete c.missingSince; return { body: p, op: 'present', why: `${c.kind} at ${c.at.join(',')}` } }
    }
  }
  if (p.mode !== 'retrofit' || !Array.isArray(containers)) return null
  // (a) allocation once nothing is unknown
  if (p.groups?.status === 'waiting') {
    const g = groupsFor(p.home, containers, allocate)
    if (g.status !== 'allocated') return null
    p.groups = g
    return { body: p, op: 'alloc', why: `${Object.keys(g.homes).length} homes, ${g.overflow.length} overflow, ${g.drain.length} drain` }
  }
  if (p.groups?.status !== 'allocated') return null
  // (b) a container not in any list -> drain
  const listed = new Set([...Object.values(p.groups.homes ?? {}).flat(), ...(p.groups.overflow ?? []), ...(p.groups.drain ?? [])])
  const fresh = containers.filter(c => !listed.has(c.k)).map(c => c.k).sort()
  if (fresh.length) {
    p.groups.drain = [...(p.groups.drain ?? []), ...fresh]
    return { body: p, op: 'adopt', why: `${fresh.length} new container(s) to drain` }
  }
  // ...a group with stock and no home -> the emptiest observed drain container (design 6.1)
  const byK = new Map(containers.map(c => [c.k, c]))
  for (const g of p.groups.pending ?? []) {
    if (p.groups.homes?.[g]?.length) continue
    const used = k => Object.values(byK.get(k)?.obs ?? {}).reduce((t, v) => t + (Number(v?.[1]) || 0), 0)
    const cand = (p.groups.drain ?? []).filter(k => byK.get(k)?.obs).sort((a, b) => used(a) - used(b) || (a < b ? -1 : 1))[0]
    if (!cand) continue
    p.groups.homes = { ...(p.groups.homes ?? {}), [g]: [cand] }
    p.groups.drain = p.groups.drain.filter(k => k !== cand)
    p.groups.pending = p.groups.pending.filter(x => x !== g)
    return { body: p, op: 'adopt', why: `group ${g} -> ${cand}` }
  }
  return null
}

/** At most this many EXTRA annex cells are appended to a committed storehouse (build spec 1.4). */
export const EXTRA_MAX = 4
/**
 * THE GROWTH STEP (build spec 1.5 (e)/(f)) -> { body, op, why } | null. Pure; rate-limited by the caller (once per 10 min per
 * bot). (e) greenfield: every section cell placed or unready and fewer than EXTRA_MAX extras -> append annex cells (READY, off
 * every keep-out, joint access) as `extra` chest cells; an `unplaced` store with nothing of its own committed -> an annex
 * store. (f) nothing committed anywhere and the plan's own cells no longer qualify -> a whole re-fit (fitTown).
 */
export function growPlan (plan, read, ctx = {}) {
  if (!plan || plan.mode !== 'greenfield') return null
  const home = plan.home
  const p = JSON.parse(JSON.stringify(plan))
  p.transitions = []
  const anyCommitted = p.plots.some(plotCommitted)
  const planned = new Set(p.plots.flatMap(cellsOfPlot).map(c => kOf(c.at)))
  // READY's whole context (Claude code r1 P2): the well rules, plinth shells and stairs (solid), the per-kind refusals
  const rctx = { zones: ctx.zones ?? [], home, planned, wells: ctx.wells ?? [], farm: ctx.farm ?? null, solid: ctx.solid ?? null, cellForbid: ctx.cellForbid ?? null }
  const store = p.plots.find(x => x.id === 'store')
  if (!anyCommitted) {
    // (f) does the plan still qualify? 4 READY chest cells and the first two stations
    const chestsReady = (store?.cells ?? []).filter(c => !readyCell(read, c.at, rctx)).length
    const st = p.plots.find(x => x.id === 'work')?.stations ?? []
    const stationsReady = st.slice(0, 2).every(c => !readyCell(read, c.at, rctx))
    if (store?.kind === 'storehouse' && chestsReady >= 4 && stationsReady) return null
    if (store?.kind === 'annex' && chestsReady >= Math.min(2, store.cells.length)) return null
    const r = fitTown(read, home, { ...ctx, containers: [] })
    if (!r.body) return null
    const same = JSON.stringify(r.body.plots) === JSON.stringify(plan.plots.map(x => x)) && r.body.s === plan.s && r.body.orientation === plan.orientation
    if (same) return null
    return { body: { ...p, ...r.body, transitions: [] }, op: 'refit', why: r.why }
  }
  if (!store) return null
  if (store.kind === 'storehouse') {
    const free = store.cells.filter(c => c.state === 'free' && !Number.isFinite(c.seenSince))
    const readyFree = free.filter(c => !readyCell(read, c.at, rctx))
    const extras = store.cells.filter(c => c.extra).length
    if (readyFree.length || extras >= EXTRA_MAX) return null
    const ko = keepouts(p)
    const a = fitAnnex(read, home, { zones: rctx.zones, wells: rctx.wells, farm: rctx.farm, solid: rctx.solid, cellForbid: rctx.cellForbid,
                                     keepout: (x, z) => ko.tier(x, home.y, z) !== null || ko.boxAt(x, z) })
    // EVERY annex cell becomes a CHEST here (the annex picked a table and a furnace too): chests never side by side -- with an
    // existing store chest OR with each other (Codex code r1 P2: the table's cell beside the first chest) -- and each READY as a
    // chest under READY's whole context
    const near = (a1, b1) => a1[1] === b1[1] && Math.abs(a1[0] - b1[0]) + Math.abs(a1[2] - b1[2]) === 1
    const ok = []
    for (const c of a.cells ?? []) {
      if (ok.length >= EXTRA_MAX - extras) break
      if (planned.has(kOf(c.at)) || store.cells.some(e => near(e.at, c.at)) || ok.some(e => near(e.at, c.at))) continue
      if (readyCell(read, c.at, { ...rctx, planned: new Set([...planned, ...ok.map(e => kOf(e.at))]) }, 'chest')) continue
      ok.push({ at: c.at, kind: 'chest', stand: c.stand ?? null, role: null, group: null, state: 'free', extra: true })
    }
    if (!ok.length) return null
    // JOINT ACCESS (spec 1.5(e)): the new cells reachable together with the plan's committed cells and the town's containers,
    // and none of them cutting an existing one off
    const ja = jointAccess(read, home, ok, { existing: ctx.existing ?? [], solid: rctx.solid })
    // the WHOLE appended set judged together with the committed cells (reserved ones filled): a cell joins only if the set so
    // far plus it still keeps every committed cell and container reachable (Codex code r2 P2: two cells could cut one jointly)
    const kept = []
    for (const c of ja.ok) if (accessKept(read, home, p, [...kept, c].map(e => e.at), { existing: ctx.existing ?? [] }).ok) kept.push(c)
    if (!kept.length) return null
    store.cells.push(...kept)
    return { body: p, op: 'extend', why: `${kept.length} extra annex cell(s)` }
  }
  if (store.kind === 'unplaced' && !plotCommitted(store)) {
    const ko = keepouts(p)
    const a = fitAnnex(read, home, { zones: rctx.zones, wells: rctx.wells, farm: rctx.farm, solid: rctx.solid, cellForbid: rctx.cellForbid, keepout: (x, z) => ko.tier(x, home.y, z) !== null })
    const chests = (a.cells ?? []).filter(c => c.kind === 'chest' && !planned.has(kOf(c.at)))
    if (!chests.length) return null
    store.kind = 'annex'; store.keepout = true
    store.cells = chests.map((c, i) => ({ at: c.at, kind: 'chest', stand: c.stand ?? null, role: i === 0 ? 'overflow' : null, group: null, state: 'free' }))
    return { body: p, op: 'refit', why: `the unplaced store -> an annex of ${chests.length}` }
  }
  return null
}

/**
 * THE AUDIT (build spec 1.9) -> { placed, present, missing, other, unknown, free, occupied, lid, unreachable, names }. Pure.
 * `home` for the reachability walk (null: not computed).
 */
export function auditPlan (plan, read, { home = null, existing = [] } = {}) {
  const out = { placed: 0, present: 0, missing: 0, other: 0, unknown: 0, free: 0, occupied: 0, lid: 0, unreachable: 0, names: [] }
  const placedCells = []
  for (const pl of plan?.plots ?? []) for (const c of [...(pl.cells ?? []), ...(pl.stations ?? [])]) {
    const b = read(c.at[0], c.at[1], c.at[2])
    if (c.state === 'placed') {
      out.placed++
      if (!b) { out.unknown++; continue }
      if ((KIND_BLOCK[c.kind] ?? /^$/).test(nm(b))) {
        out.present++; placedCells.push(c)
        if (c.kind === 'chest' && lidBlocks(read(c.at[0], c.at[1] + 1, c.at[2]))) { out.lid++; out.names.push(`lid:${c.at.join(',')}`) }
      } else if (replaceableCell(b) || nm(b) === 'air') { out.missing++; out.names.push(`missing:${c.kind}@${c.at.join(',')}`) } else { out.other++; out.names.push(`${nm(b)}@${c.at.join(',')}`) }
    } else if (c.state === 'free') {
      out.free++
      // OCCUPIED counts only cells the fit judged READY (Claude code r1 P2): a greenfield cell written ready:false over a ground
      // bump is terrain the fit already knew, not a structure or furniture on a planned cell
      if (c.ready !== false && b && !replaceableCell(b) && nm(b) !== 'air' && !(KIND_BLOCK[c.kind] ?? /^$/).test(nm(b))) { out.occupied++; out.names.push(`${nm(b)}@${c.at.join(',')}`) }
    }
  }
  if (home && placedCells.length) {
    const reach = walkable(read, home, new Set())
    for (const c of placedCells) if (!standFor(reach, c.at, c.stand)) { out.unreachable++; out.names.push(`unreachable:${c.at.join(',')}`) }
  }
  out.names = out.names.slice(0, 6)
  return out
}
export const auditDetail = (a, extra = {}) => `placed=${a.placed} present=${a.present} missing=${a.missing} other=${a.other} unknown=${a.unknown} free=${a.free} occupied=${a.occupied} lid=${a.lid} unreachable=${a.unreachable}${Object.entries(extra).map(([k, v]) => ` ${k}=${v}`).join('')}${a.names.length ? ` first=${a.names.join(';')}` : ''}`.slice(0, 300)

// ---- the rows ------------------------------------------------------------------------------------------------------------

export const townPlanModeDetail = ({ seed = 'absent', zones = 'absent' } = {}) =>
  `phase=mode plan=${TOWNPLAN.on ? 'on' : 'off'} v=1 template=${TEMPLATE} tick_s=${PLAN_TICK_MS / 1000} seed=${seed} zones=${zones}`
export const townPlanRowDetail = (f = {}) => ['op', 'result', 'gen', 'prev', 'mode', 'orient', 'store', 'work', 'ready', 'access', 'zones', 'why']
  .filter(k => f[k] != null).map(k => `${k}=${String(f[k]).replace(/\s+/g, '_').slice(0, k === 'why' ? 120 : 40)}`).join(' ')
