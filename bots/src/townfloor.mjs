// THE TOWN FLOOR (townfloor-01; OWNER 10-14 "lets absolutely do what you recommend with the cobblestones"): the bots fill the
// ground they dug out from under their own town, with the cobble they carry. Placements only; never a dig.
//
// WHY. Region files 10-13/10-14 (docs/reports/townground-2026-10-13.md, townfloor-2026-10-14.md): within 16 blocks of home
// the bots have removed ~100k cells since the worlds began; the 13x13 town platform floats over a cavern (110-169 of its
// 169 cells have air under them); 64% of the top four layers are gone. Meanwhile ~17,600 cobble rides in the bags (the
// biggest slot user) and the junk well -- usable in 5-6 of 16 towns -- is the only outlet stocktarget leaves for it. The
// owner: surplus cobble is to be USED; the well is the overflow, not the main outlet.
//
// WHAT. One deterministic town job. Inside the repair box -- Chebyshev FLOOR_HALF (16, the town-ground zone's square)
// around home, from the town's floor level L = home.y - 2 (the platform's top) down FLOOR_DEPTH (10) layers, i.e. exactly
// the zone's protected band -- every OPEN cell (air or a replaceable plant, never a liquid) is a target, and the job puts a
// stone block in it:
//   - SUPPORTED: a cell is placed only on a solid block directly below it (bottom-up in every column), so the fill grows
//     from the ground up and never bridges over a void;
//   - FROM A STAND THE TOWN REACHES AND THAT WALKS BACK TO THE TOWN AFTER THE CLICK (the plinth planner's rule): the
//     builder never walls itself in, and never needs to dig to reach or to leave;
//   - NEVER SEALS ANYTHING: after the click every open neighbour of the cell still connects to the open air above the
//     floor (or is a small empty pocket), and every other player near the town still walks to it;
//   - COLUMNS TOPPED OUT, FAR FIRST, NEVER CUTTING THE WAY: the highest eligible cell first (a 1-high gap under a roof
//     cannot be stood in), the farthest from the town next, and a fill that would cost another stand its way there and
//     back waits -- so a dead-end tunnel or a cavern is filled from its far end back to its mouth;
//   - NEVER INTO A PROTECTED CELL: a liquid or any cell over one (water stays open to the sky), a sapling's growth column,
//     the cell over farmland, anything within one of town furniture (containers, stations, doors, beds, the composter),
//     the junk well's shell and column, and any record's keep-out.
// The floor is a STOCK of holes, not a plan: every visit re-derives its next steps from the world as it is (a bot that
// digs a new hole adds a target; a placement by anyone removes one). The record holds the lease, counters and stuck cells.
//
// FUNDED by the bag's surplus only: andesite/diorite/granite first (the well's junk), then cobble while the bag keeps
// COBBLE_RESERVE (64) of cobble -- the exit contract's reserve is never spent.
//
// Nothing here touches the world or the disk: skills.mjs supplies read(), the entities, the records and the clicks.

import { townDistance, TOWN_RADIUS, CLEARANCE_CONTAINER, sameWorld } from './composter.mjs'
import { COBBLE_RESERVE } from './bankable.mjs'
import { fullCube } from './well.mjs'
import * as TG from './townground.mjs'

export const FLOOR_VERSION = 1
/** Chebyshev half-width of the repair box: the town-ground zone's square (townground.mjs TOWN_GROUND_HALF). */
export const FLOOR_HALF = 16
/** Layers below the floor level: L-10 = home.y-12, the zone's depth (townground.mjs TOWN_GROUND_DEPTH). */
export const FLOOR_DEPTH = 10
/** The platform's half-width (place-town.py stamps 13x13 at home.y-2): tier 0, filled first. */
export const PLATFORM_HALF = 6
/** Eye to the clicked face's centre (vanilla block_interaction_range 4.5). */
export const FLOOR_REACH = 4.5
export const EYE_HEIGHT = 1.62
/** Placements per visit, at most. */
export const FLOOR_STEPS_PER_VISIT = 32
/** A visit starts only with at least this many blocks to spend. */
export const FLOOR_MIN_FUND = 8
/** Between two floor orders of one bot. */
export const FLOOR_COOLDOWN_MS = Number.isFinite(Number(process.env.FLOOR_COOLDOWN_MS)) && process.env.FLOOR_COOLDOWN_MS !== '' ? Number(process.env.FLOOR_COOLDOWN_MS) : 10 * 60 * 1000
/** After a visit that found nothing to do (no target the town reaches): the floor rarely changes that fast. */
export const FLOOR_NONE_BACKOFF_MS = 60 * 60 * 1000
/** After a failed visit (a fault, every placement refused by the server). */
export const FLOOR_BACKOFF_MS = 30 * 60 * 1000
/** One builder per town: the lease is held this long and renewed at every placement. */
export const FLOOR_LEASE_MS = 3 * 60 * 1000
/** A cell whose placement the server dropped this many times (read back not solid) is skipped for STUCK_HOLD_MS. */
export const STUCK_TRIES = 2
export const STUCK_HOLD_MS = 24 * 60 * 60 * 1000
/** At most this many candidates are tried per step before the visit stops (the rest are left for later). */
export const FLOOR_MAX_TRIES = 400
/** A pocket a placement may close off (an EMPTY dead end this small); anything larger, or anything unbounded, refuses. */
export const POCKET_MAX = 8
/** The seal flood's bound, in cells, per component. */
export const SEAL_FLOOD_MAX = 6000
/** The blocks the floor is built from, spent first first: the decorations the well would otherwise take, then the stone. */
export const FLOOR_BLOCKS = Object.freeze(['andesite', 'diorite', 'granite', 'cobbled_deepslate', 'cobblestone'])
const COBBLE = new Set(['cobblestone', 'cobbled_deepslate'])

/** Cells a block may be placed INTO: air and the plants a placement replaces in vanilla. Flowers, saplings, torches and
 *  snow are NOT replaceable: a hole holding one is left. */
export const FLOOR_REPLACEABLE = new Set(['air', 'cave_air', 'void_air', 'short_grass', 'fern', 'dead_bush', 'tall_grass', 'large_fern'])
const LIQUID = /^(water|lava|flowing_water|flowing_lava|bubble_column)$/
const SAPLING = /(_sapling$|_propagule$|^azalea$|^flowering_azalea$)/
/** Town furniture no planned cell may touch (Chebyshev 1, 3D): a lid must open, a door must swing, a bed must be slept in. */
const FURNITURE = /(_door$|_bed$|^lectern$|^bell$|^crafting_table$|^composter$|^cartography_table$|^smithing_table$|^loom$|^grindstone$|^stonecutter$|^anvil$|_trapdoor$|^enchanting_table$|^jukebox$|^note_block$)/
const isFurniture = name => CLEARANCE_CONTAINER.test(name ?? '') || FURNITURE.test(name ?? '')

/** The block a placement leaves, as read() returns it (a full collision cube). */
export const PLACED = Object.freeze({ name: 'cobblestone', boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]], hardness: 2, props: null })
export const AIR = Object.freeze({ name: 'air', boundingBox: 'empty', shapes: [], hardness: 0, props: null })

/** A cell's key: one exact number (|x|,|z| < 2^20, -512 <= y < 512), so the hot maps and sets never build strings. */
export const cellKey = (x, y, z) => ((x + 1048576) * 2097152 + (z + 1048576)) * 1024 + (y + 512)
const K = cellKey
export const keyCell = k => { const y = (k % 1024) - 512; const r = Math.floor(k / 1024); const z = (r % 2097152) - 1048576; const x = Math.floor(r / 2097152) - 1048576; return { x, y, z } }
const solid = b => !!b && b.boundingBox === 'block'
const isLiquid = b => !!b && LIQUID.test(b.name ?? '')
/** Open for a body or for air: no collision, not a liquid. */
export const passable = b => !!b && b.boundingBox === 'empty' && !isLiquid(b)
const replaceable = b => !!b && FLOOR_REPLACEABLE.has(b.name)
/** A full collision cube (well.mjs fullCube) -- or, for a reader without collision shapes, any solid block. */
const fullFloor = b => solid(b) && (!Array.isArray(b.shapes) || fullCube(b))
/** Where the BUILDER stands for a click: standable on a full cube, so its eye is where the reach and sight math put it
 *  (Codex r2 P2: a slab or a path block lowers the eye). The walk model itself stays permissive -- any solid floor is a
 *  node -- so lostWay protects every route a bot can walk. Pure. */
export const builderStand = (read, x, y, z) => standable(read, x, y, z) && fullFloor(read(x, y - 1, z))
const CARD = Object.freeze([[1, 0], [-1, 0], [0, 1], [0, -1]])
const SIX = Object.freeze([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]])

// ---- the world view ---------------------------------------------------------------------------------------------------

/** An overlay on read(): `cells` (Map key -> block) wins. Pure. */
export function overlay (read, cells) {
  return (x, y, z) => { const k = K(x, y, z); return cells.has(k) ? cells.get(k) : read(x, y, z) }
}
/** read() memoised (a world view that does not change during one plan). Pure. */
export function memoRead (read) {
  const m = new Map()
  return (x, y, z) => { const k = K(x, y, z); if (m.has(k)) return m.get(k); const v = read(x, y, z); m.set(k, v); return v }
}

// ---- the box ------------------------------------------------------------------------------------------------------------

/**
 * IS THE TOWN-GROUND ZONE IN THIS BUILD? (townzone-01: townground.mjs townTargetPermit refuses gather/mine/ore-tunnel
 * target digs of town ground). Without it a gatherer digs the fill straight back out -- cobblestone is a gather target --
 * so the floor order never fires without it (Claude r1 P2-4). Pure (a property of the code, not the world).
 */
export const zoneLive = (tg = TG) => typeof tg?.townTargetPermit === 'function'

/** The town's floor level: the platform's top (place-town.py stamps stone_bricks at home.y - 2). Pure. */
export const floorLevel = home => Math.floor(home.y) - 2
/** The repair box -> { x0, x1, z0, z1, y0, y1 } (inclusive). Pure. */
export function floorBox (home) {
  const hx = Math.floor(home.x), hz = Math.floor(home.z), L = floorLevel(home)
  return { x0: hx - FLOOR_HALF, x1: hx + FLOOR_HALF, z0: hz - FLOOR_HALF, z1: hz + FLOOR_HALF, y0: L - FLOOR_DEPTH, y1: L }
}
/** The walk probe's box: the repair box, 8 around, 8 lower and 6 above the floor (a route home that leaves the repair
 *  box and comes back is seen as long as it stays inside this). Pure. */
export function walkBox (home) {
  const b = floorBox(home)
  return { x0: b.x0 - 8, x1: b.x1 + 8, z0: b.z0 - 8, z1: b.z1 + 8, y0: b.y0 - 8, y1: b.y1 + 6 }
}
/** How far above the floor level the seal flood travels. */
export const SKY_ABOVE = 10
/** The overworld's top cell (1.18+: build height 320). The sky is a column open from the cell up to here. */
export const WORLD_TOP = 319
/** The seal flood's region: the repair box, 8 around, 8 below and SKY_ABOVE above. "Outside" is an open cell at or above
 *  L+1 whose whole column up to WORLD_TOP is open -- the real sky, never mere height and never a finite scan (Codex r2/r3
 *  P1: a chamber roofed above any scan limit). Pure. */
export function sealBox (home) {
  const b = floorBox(home)
  return { x0: b.x0 - 8, x1: b.x1 + 8, z0: b.z0 - 8, z1: b.z1 + 8, y0: b.y0 - 8, y1: b.y1 + SKY_ABOVE }
}
const inBox = (box, x, y, z) => x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1 && z >= box.z0 && z <= box.z1
/** 0 = the platform square, 1 = the rest of the box. Pure. */
export const floorTier = (home, x, z) => (Math.max(Math.abs(x - Math.floor(home.x)), Math.abs(z - Math.floor(home.z))) <= PLATFORM_HALF ? 0 : 1)

// ---- which cells: targets and the protected -----------------------------------------------------------------------------

const GRAVITY = /(^sand$|^red_sand$|^gravel$|_concrete_powder$|^anvil$|^chipped_anvil$|^damaged_anvil$|^pointed_dripstone$|^scaffolding$|^suspicious_sand$|^suspicious_gravel$|^dragon_egg$)/
/** A placement updates its neighbours: a gravity block beside or below the cell with nothing solid under it falls then. */
const unsupportedGravity = (read, x, y, z) => { const b = read(x, y, z); if (!b || !GRAVITY.test(b.name ?? '')) return false; const u = read(x, y - 1, z); return !u || !solid(u) }
/** Liquid this near the cell: a placement could change where flowing water or lava goes next (Codex r1 P1). */
export const LIQUID_CLEAR_H = 2
/**
 * THE CELL'S OWN HAZARDS -> null | reason. Pure; asked of every target (floorCells) and again at the click (stepRefusal):
 *   gravity      a sand/gravel-like block beside or below it with nothing solid under it (the placement's block update
 *                drops it -- onto a body, into a tunnel)
 *   near_liquid  a liquid within LIQUID_CLEAR_H horizontally, one below to one above (a flow could be redirected)
 *   unknown      a cell of that neighbourhood not loaded
 * The block directly above is exempt from the gravity rule: the placement is what holds it up.
 */
export function cellHazard (read, x, y, z) {
  for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0]]) {
    if (!read(x + dx, y + dy, z + dz)) return 'unknown'
    if (unsupportedGravity(read, x + dx, y + dy, z + dz)) return 'gravity'
  }
  for (let dx = -LIQUID_CLEAR_H; dx <= LIQUID_CLEAR_H; dx++) for (let dz = -LIQUID_CLEAR_H; dz <= LIQUID_CLEAR_H; dz++) for (let dy = -1; dy <= 1; dy++) {
    const b = read(x + dx, y + dy, z + dz)
    if (!b) return 'unknown'
    if (isLiquid(b)) return 'near_liquid'
  }
  return null
}

/**
 * EVERY CELL OF THE BOX, CLASSIFIED -> { targets: [{x,y,z,tier}], protectedKeys: Set, tally }. Pure.
 *   target     open (passable or a replaceable plant) and not protected
 *   protected  open but never filled: over a liquid in its column (water stays open to the sky); in a sapling's growth
 *              column (the sapling's cell up 7); directly over farmland; within Chebyshev 1 (3D) of town furniture; inside
 *              a keep-out ({ x, y, z, r, up?, down? }: Chebyshev r horizontally, y from y-down to y+up; the junk well,
 *              a record's cells)
 * `unknown` counts cells not loaded: a visit with any unknown cell in the box plans nothing (never on a guess).
 */
export function floorCells (read, home, { keepOut = [] } = {}) {
  const box = floorBox(home)
  const tally = { open: 0, target: 0, liquid: 0, solid: 0, unknown: 0, over_liquid: 0, sapling: 0, farmland: 0, furniture: 0, keepout: 0, plant: 0, gravity: 0, near_liquid: 0 }
  const prot = new Set()
  const protect = (x, y, z, why) => { if (inBox(box, x, y, z)) { const k = K(x, y, z); if (!prot.has(k)) { prot.add(k); protWhy.set(k, why) } } }
  const protWhy = new Map()
  // pass 1: what must stay open, found from the box and one cell around it (furniture beside the box still counts)
  for (let x = box.x0 - 1; x <= box.x1 + 1; x++) {
    for (let z = box.z0 - 1; z <= box.z1 + 1; z++) {
      let liquidBelow = false
      for (let y = box.y0 - 1; y <= box.y1 + 8; y++) {
        const b = read(x, y, z)
        if (!b) continue
        const n = b.name ?? ''
        if (isLiquid(b)) { liquidBelow = true; continue }
        if (liquidBelow && y <= box.y1 && passable(b)) protect(x, y, z, 'over_liquid')
        else if (solid(b)) liquidBelow = false                   // a solid block closes the water off from what is above
        if (SAPLING.test(n)) for (let u = 0; u <= 7; u++) protect(x, y + u, z, 'sapling')
        if (n === 'farmland') protect(x, y + 1, z, 'farmland')
        if (isFurniture(n)) {
          for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) protect(x + dx, y + dy, z + dz, 'furniture')
          // a container's lid opens only under a non-solid block: the cell over it stays open (covered by dy = 1)
        }
      }
    }
  }
  for (const o of (Array.isArray(keepOut) ? keepOut : [])) {
    if (!o || !Number.isFinite(o.x) || !Number.isFinite(o.y) || !Number.isFinite(o.z)) continue
    const r = Number.isFinite(o.r) ? o.r : 1, up = Number.isFinite(o.up) ? o.up : r, down = Number.isFinite(o.down) ? o.down : r
    for (let x = o.x - r; x <= o.x + r; x++) for (let z = o.z - r; z <= o.z + r; z++) for (let y = o.y - down; y <= o.y + up; y++) protect(x, y, z, 'keepout')
  }
  const targets = []
  for (let x = box.x0; x <= box.x1; x++) {
    for (let z = box.z0; z <= box.z1; z++) {
      for (let y = box.y0; y <= box.y1; y++) {
        const b = read(x, y, z)
        if (!b) { tally.unknown++; continue }
        if (isLiquid(b)) { tally.liquid++; continue }
        if (!(passable(b) || replaceable(b))) { tally.solid++; continue }
        if (!replaceable(b)) { tally.plant++; continue }         // a flower, a sapling, a torch, snow: never placed into
        tally.open++
        const k = K(x, y, z)
        if (prot.has(k)) { const w = protWhy.get(k); tally[w] = (tally[w] ?? 0) + 1; continue }
        const hz = cellHazard(read, x, y, z)
        if (hz === 'unknown') { tally.unknown++; continue }
        if (hz) { tally[hz] = (tally[hz] ?? 0) + 1; continue }
        targets.push({ x, y, z, tier: floorTier(home, x, z) })
      }
    }
  }
  tally.target = targets.length
  return { targets, protectedKeys: prot, tally }
}

// ---- walking: the probe that stands in for the pathfinder (plinth-01's rules) ----------------------------------------------

/** Can a body stand with its feet here? feet and head open (no liquid), a solid floor. Pure. */
export function standable (read, x, y, z, strict = false) {
  if (!strict) return passable(read(x, y, z)) && passable(read(x, y + 1, z)) && solid(read(x, y - 1, z))
  const f = read(x, y, z), h = read(x, y + 1, z)
  return clearBody(f) && clearBody(h) && fullFloor(read(x, y - 1, z))
}
/** STRICT walking (the builder's own route, Paper 10-14: a stand reached in the model only over beds and chests was
 *  unreachable to the pathfinder): floors are full cubes, and the body never passes what the pathfinder avoids. */
const AVOID = /(cobweb|fire$|sweet_berry_bush|powder_snow|wither_rose|campfire|magma_block|pointed_dripstone|_pressure_plate$|tripwire)/
const clearBody = b => passable(b) && !AVOID.test(b.name ?? '')

/**
 * EVERY FEET CELL REACHABLE ON FOOT FROM `start`, WITH ITS WALK DISTANCE -> Map cellKey -> steps. Pure. A conservative
 * stand-in for the pathfinder (plinth.mjs walkReach): the four cardinal moves -- walk, step up 1 (head room above the
 * origin), drop 1..3 -- within `box`, no digging, no placing, no swimming, no diagonal.
 */
export function walkDist (read, start, { box, maxNodes = 120_000, strict = false } = {}) {
  const dist = new Map()
  if (!start || !standable(read, start.x, start.y, start.z, strict)) return dist
  const ok = (x, y, z) => (!box || inBox(box, x, y, z)) && standable(read, x, y, z, strict)
  const step = b => (strict ? fullFloor(b) : solid(b))
  const q = [[start.x, start.y, start.z, 0]]
  dist.set(K(start.x, start.y, start.z), 0)
  const push = (x, y, z, d) => { const k = K(x, y, z); if (!dist.has(k)) { dist.set(k, d); q.push([x, y, z, d]) } }
  for (let i = 0; i < q.length && dist.size < maxNodes; i++) {
    const [x, y, z, d] = q[i]
    for (const [dx, dz] of CARD) {
      const nx = x + dx, nz = z + dz
      if (ok(nx, y, nz)) { push(nx, y, nz, d + 1); continue }
      if (step(read(nx, y, nz)) && passable(read(x, y + 2, z)) && ok(nx, y + 1, nz)) { push(nx, y + 1, nz, d + 1); continue }
      if ((box && !inBox(box, nx, y, nz)) || !passable(read(nx, y, nz)) || !passable(read(nx, y + 1, nz))) continue
      for (let dd = 1; dd <= 3; dd++) {
        const fy = y - dd
        if (!passable(read(nx, fy, nz))) break
        if (solid(read(nx, fy - 1, nz))) { if (ok(nx, fy, nz)) push(nx, fy, nz, d + 1); break }   // ok() judges its floor
      }
    }
  }
  return dist
}

/**
 * EVERY FEET CELL FROM WHICH A BODY WALKS TO `target` -> Set of cellKey. Pure. walkDist's moves run backwards (plinth.mjs
 * walkReachBack): `walkBack(r, t).has(c)` iff `walkDist(r, c).has(t)` (a property test checks it).
 */
export function walkBack (read, target, { box, maxNodes = 120_000, strict = false } = {}) {
  const seen = new Set()
  if (!target || !standable(read, target.x, target.y, target.z, strict)) return seen
  const ok = (x, y, z) => (!box || inBox(box, x, y, z)) && standable(read, x, y, z, strict)
  const q = [[target.x, target.y, target.z]]
  seen.add(K(target.x, target.y, target.z))
  const push = (x, y, z) => { const k = K(x, y, z); if (!seen.has(k)) { seen.add(k); q.push([x, y, z]) } }
  for (let i = 0; i < q.length && seen.size < maxNodes; i++) {
    const [x, y, z] = q[i]
    for (const [dx, dz] of CARD) {
      const ax = x - dx, az = z - dz
      if (ok(ax, y, az)) push(ax, y, az)
      if (ok(ax, y - 1, az) && passable(read(ax, y + 1, az))) push(ax, y - 1, az)
      for (let d = 1; d <= 3; d++) {
        const ya = y + d
        let clear = true
        for (let c = y; c <= ya + 1; c++) { if ((box && !inBox(box, x, c, z) && c >= ya) || !passable(read(x, c, z))) { clear = false; break } }
        if (!clear) break
        if (ok(ax, ya, az)) push(ax, ya, az)
      }
    }
  }
  return seen
}

/** The standable feet cell nearest home (within 4 horizontally, home.y -3..+3), or null: where the probe starts. Pure. */
export function startNear (read, home) {
  let best = null
  const hy = Math.floor(home.y)
  for (let dx = -4; dx <= 4; dx++) {
    for (let dz = -4; dz <= 4; dz++) {
      for (let dy = -3; dy <= 3; dy++) {
        const x = Math.floor(home.x) + dx, y = hy + dy, z = Math.floor(home.z) + dz
        if (!standable(read, x, y, z, true)) continue
        const d = dx * dx + dz * dz + 2 * dy * dy
        if (!best || d < best.d || (d === best.d && K(x, y, z) < K(best.x, best.y, best.z))) best = { x, y, z, d }
      }
    }
  }
  return best ? { x: best.x, y: best.y, z: best.z } : null
}

// ---- one click (plinth.mjs's rules) -------------------------------------------------------------------------------------

/** The centre of the face of `ref` that looks along `face` (the click point). */
export const faceCentre = (ref, face) => ({ x: ref.x + 0.5 + face[0] * 0.5, y: ref.y + 0.5 + face[1] * 0.5, z: ref.z + 0.5 + face[2] * 0.5 })

/** Is the line from the eye to a point clear? Every cell the segment passes through (sampled every 0.05, the last 2%
 *  excluded: the clicked face itself) is open, or is the target cell. Pure. */
export function sightClear (read, eye, point, through = null) {
  const dx = point.x - eye.x, dy = point.y - eye.y, dz = point.z - eye.z
  const len = Math.hypot(dx, dy, dz)
  const n = Math.max(2, Math.ceil(len / 0.05))
  for (let i = 0; i <= n * 0.98; i++) {
    const t = i / n
    const x = Math.floor(eye.x + dx * t), y = Math.floor(eye.y + dy * t), z = Math.floor(eye.z + dz * t)
    if (through != null && K(x, y, z) === through) continue
    const b = read(x, y, z)
    if (!b || b.boundingBox !== 'empty') return false
  }
  return true
}

/** May a click use this block as its support? Solid, not a liquid, and not a block a click would USE instead. Pure. */
export function refUsable (b) {
  return solid(b) && (!Array.isArray(b.shapes) || fullCube(b)) && !isLiquid(b) && !/_trapdoor$|_door$|^chest$|^trapped_chest$|^barrel$|_shulker_box$|^crafting_table$|furnace$|^smoker$|^hopper$|^lectern$|^composter$|_bed$|_sign$|^bell$|^anvil$/.test(b.name ?? '')
}

/**
 * THE CLICKS THAT CAN PLACE INTO `cell` -> [{ ref, face }]. Pure. ONLY ON A SOLID BLOCK BELOW: a floor cell is never
 * bridged over a void. The click is the top face of the block below (first) or a side face of a solid neighbour; never
 * a bottom face. Empty when the cell below is not a usable solid.
 */
export function floorSupports (read, cell) {
  const below = read(cell.x, cell.y - 1, cell.z)
  if (!fullFloor(below)) return []                       // a FULL cube under it (Codex r2 P2: not a slab, not a fence)
  const out = []
  if (refUsable(below)) out.push({ ref: { x: cell.x, y: cell.y - 1, z: cell.z }, face: [0, 1, 0] })
  for (const [dx, dz] of CARD) {
    const ref = { x: cell.x + dx, y: cell.y, z: cell.z + dz }
    if (refUsable(read(ref.x, ref.y, ref.z))) out.push({ ref, face: [-dx || 0, 0, -dz || 0] })
  }
  return out
}

/**
 * WHERE TO STAND FOR ONE CLICK -> { x, y, z } | null. Pure (plinth.mjs standFor). Only `reach` cells; never in the target
 * cell (feet or head) nor standing on it; a top face only from above; within FLOOR_REACH; a clear line of sight. `prefer`
 * (the last stand): the nearest stand to it wins, then the lowest key.
 */
export function standFor (read, { target, point, topFace = false, reach, prefer = null, radius = 5 }) {
  let best = null
  const through = K(target.x, target.y, target.z)
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dy = -4; dy <= 3; dy++) {
        const x = target.x + dx, y = target.y + dy, z = target.z + dz
        const k = K(x, y, z)
        if (!reach.has(k)) continue
        if (x === target.x && z === target.z && (y === target.y || y + 1 === target.y || y - 1 === target.y)) continue
        if (!builderStand(read, x, y, z)) continue
        const eye = { x: x + 0.5, y: y + EYE_HEIGHT, z: z + 0.5 }
        if (topFace && eye.y <= point.y + 1e-9) continue
        if (Math.hypot(eye.x - point.x, eye.y - point.y, eye.z - point.z) > FLOOR_REACH) continue
        if (!sightClear(read, eye, point, through)) continue
        const d = prefer ? Math.hypot(x - prefer.x, y - prefer.y, z - prefer.z) : Math.hypot(dx, dy, dz)
        if (!best || d < best.d - 1e-9 || (Math.abs(d - best.d) <= 1e-9 && k < best.k)) best = { x, y, z, d, k }
      }
    }
  }
  return best ? { x: best.x, y: best.y, z: best.z } : null
}

// ---- never seal anything ------------------------------------------------------------------------------------------------

/**
 * WHERE DOES THE OPEN SPACE AT `from` LEAD? -> 'surface' | 'pocket' | 'unbounded', with its cells for a pocket. Pure.
 * A 6-neighbour flood through passable cells (a liquid is not air: water does not count as a way out) inside `region`:
 *   surface    it reaches the SKY: an open cell at or above surfaceY whose whole column up to WORLD_TOP is open
 *   pocket     it ends inside the region without reaching the sky (a closed void; `cells` lists it)
 *   unbounded  it leaves the region, or passes `max` cells: where it leads is not known (never treated as safe)
 */
export function openReach (read, from, { region, surfaceY, max = SEAL_FLOOD_MAX, skyCache = null, skyRead = null } = {}) {
  // the column above the region is read RAW (Claude r3 P3-1: ~250 cells a column through a memo cost 160 MB under a full
  // canopy); placements are never above the floor level, so the unplaced world is the sky's world
  const above = typeof skyRead === 'function' ? skyRead : read
  read = memoRead(read)
  if (!passable(read(from.x, from.y, from.z))) return { kind: 'solid', cells: [] }
  const seen = new Set([K(from.x, from.y, from.z)])
  const q = [[from.x, from.y, from.z]]
  let leaked = false
  // THE SKY, per column: the lowest y from which every cell up to WORLD_TOP is open (memoised; a cell not loaded, or
  // anything solid or liquid, closes the column there). Placements are never above the floor level, so a plan may share
  // one cache (skyCache) across all its steps.
  const skyFrom = skyCache ?? new Map()
  const sky = (x, y, z) => {
    if (y < surfaceY) return false
    const ck = K(x, 0, z)
    let f = skyFrom.get(ck)
    if (f === undefined) {
      f = WORLD_TOP + 1
      for (let yy = WORLD_TOP; yy >= surfaceY; yy--) { if (!passable(yy > region.y1 ? above(x, yy, z) : read(x, yy, z))) break; f = yy }
      skyFrom.set(ck, f)
    }
    return y >= f
  }
  for (let i = 0; i < q.length; i++) {
    const [x, y, z] = q[i]
    if (sky(x, y, z)) return { kind: 'surface', cells: null }
    for (const [dx, dy, dz] of SIX) {
      const nx = x + dx, ny = y + dy, nz = z + dz
      const k = K(nx, ny, nz)
      if (seen.has(k)) continue
      if (!inBox(region, nx, ny, nz)) { if (passable(read(nx, ny, nz)) || !read(nx, ny, nz)) leaked = true; continue }
      const b = read(nx, ny, nz)
      if (!b) { leaked = true; continue }                       // not loaded: where it leads is not known
      if (!passable(b)) continue
      seen.add(k)
      if (seen.size > max) return { kind: 'unbounded', cells: null }
      q.push([nx, ny, nz])
    }
  }
  if (leaked) return { kind: 'unbounded', cells: null }
  return { kind: 'pocket', cells: q.map(([x, y, z]) => ({ x, y, z })) }
}

/**
 * DOES PLACING INTO `cell` SEAL ANYTHING? -> null (no) | reason. Pure. After the placement, every passable 6-neighbour of
 * the cell must still lead to the sky (an open cell at or above L+1 whose column is open up to WORLD_TOP), or be an EMPTY
 * pocket of at most POCKET_MAX
 * cells (a small dead end the fill closes, whether or not it was closed before). A pocket holding a body or an item
 * ('entities': [{ x, y, z }] feet/item cells) is never closed, a larger pocket refuses, and space whose end is not known
 * ('unbounded') is never cut. Bodies that can WALK to the town are protected by lostWay, not by this air rule.
 */
export function sealRefusal (read, cell, { home, entities = [], skyCache = null, skyRead = null } = {}) {
  const region = sealBox(home), surfaceY = floorLevel(home) + 1
  const after = overlay(read, new Map([[K(cell.x, cell.y, cell.z), PLACED]]))
  const seen = new Set()
  for (const [dx, dy, dz] of SIX) {
    const n = { x: cell.x + dx, y: cell.y + dy, z: cell.z + dz }
    // (no height shortcut: a neighbour above the floor level is outside only if its flood reaches the sky -- Codex r2 P1)
    if (!passable(after(n.x, n.y, n.z))) continue
    if (seen.has(K(n.x, n.y, n.z))) continue
    const r = openReach(after, n, { region, surfaceY, skyCache, skyRead })
    if (r.kind === 'surface') continue
    // space whose end is not known (it leaves the region, or a cell is not loaded) is never cut off from the surface
    if (r.kind === 'unbounded') return 'unbounded'
    for (const c of r.cells) seen.add(K(c.x, c.y, c.z))
    const inside = new Set(r.cells.map(c => K(c.x, c.y, c.z)))
    if ((Array.isArray(entities) ? entities : []).some(e => e && (inside.has(K(Math.floor(e.x), Math.floor(e.y), Math.floor(e.z))) ||
        inside.has(K(Math.floor(e.x), Math.floor(e.y) + 1, Math.floor(e.z)))))) return 'entity'
    if (r.cells.length > POCKET_MAX) return 'pocket'
  }
  return null
}

// ---- the plan: the next steps, from the world as it is -----------------------------------------------------------------

/**
 * THE NEXT PLACEMENTS -> { steps: [{ c: [x,y,z], r: [x,y,z], f: [dx,dy,dz], s: [x,y,z], tier }], tally, why }. Pure.
 * A generator (`planFloorSteps`) so a bot's event loop runs between steps; `planFloor` runs it to the end.
 *   read      the world (cells not loaded are null)
 *   home      the town
 *   start     where the walk starts (startNear(home) when absent)
 *   entities  other bodies and items: never sealed in, never placed into ([{ x, y, z, player? }])
 *   keepOut   records' cells (floorCells)
 *   skip      Set of cellKeys never tried (stuck cells)
 *   maxSteps  placements to plan (the visit's budget)
 * Each step: the eligible targets (open, not protected, a full cube below) in order -- COLD last (cells refused on an
 * earlier visit wait behind every untried one), then the tier (the platform square first), then the HIGHEST (a column is
 * topped out before the bot moves on: a 1-high gap under a roof can never be stood in, so a layer filled everywhere first
 * would strand the layer over it), then FAR FIRST (the walk distance of the nearest stand), then the key -- and the first
 * one with a support, a builder's stand the town reaches that walks back to the town after the click, no seal
 * (sealRefusal) and NO CUT (lostWay: no other stand loses its way to the town; a cut is always refused) is taken. It is
 * applied to the view and the next step is planned on it. `why` names what stopped the plan short of maxSteps
 * ('search_budget': the tries ran out, which is not "nothing to do").
 */
export function planFloor (opts = {}) {
  const it = planFloorSteps(opts)
  for (;;) { const r = it.next(); if (r.done) return r.value }
}
/**
 * ACCESS: for every target, the walk distance of the nearest reach cell within ACCESS_R of its column, its feet from
 * ACCESS_BELOW below to ACCESS_ABOVE above the target (where a stand for it can be: a pit's floor is served from the pit,
 * not from the rim three blocks over it) -> (t) => distance | Infinity. Pure. A per-level 2D minimum filter over the reach map, so
 * a plan step costs one pass over the box rather than a search per target. It only ORDERS (far first) and pre-filters:
 * standFor decides.
 */
export const ACCESS_R = 4
export const ACCESS_BELOW = 1
export const ACCESS_ABOVE = 2
export function accessIndex (dist, home) {
  const box = walkBox(home)
  const W = box.x1 - box.x0 + 1, D = box.z1 - box.z0 + 1, H = box.y1 - box.y0 + 1
  const raw = new Float64Array(W * D * H).fill(Infinity)
  for (const [k, d] of dist) {
    const c = keyCell(k)
    if (!inBox(box, c.x, c.y, c.z)) continue
    const i = ((c.y - box.y0) * W + (c.x - box.x0)) * D + (c.z - box.z0)
    if (d < raw[i]) raw[i] = d
  }
  // separable min filter, x then z, per level
  const tmp = new Float64Array(W * D * H).fill(Infinity), out = new Float64Array(W * D * H).fill(Infinity)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let z = 0; z < D; z++) {
    let m = Infinity
    for (let dx = -ACCESS_R; dx <= ACCESS_R; dx++) { const xx = x + dx; if (xx < 0 || xx >= W) continue; const v = raw[(y * W + xx) * D + z]; if (v < m) m = v }
    tmp[(y * W + x) * D + z] = m
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let z = 0; z < D; z++) {
    let m = Infinity
    for (let dz = -ACCESS_R; dz <= ACCESS_R; dz++) { const zz = z + dz; if (zz < 0 || zz >= D) continue; const v = tmp[(y * W + x) * D + zz]; if (v < m) m = v }
    out[(y * W + x) * D + z] = m
  }
  return t => {
    let best = Infinity
    const x = t.x - box.x0, z = t.z - box.z0
    if (x < 0 || x >= W || z < 0 || z >= D) return Infinity
    for (let fy = t.y - ACCESS_BELOW; fy <= t.y + ACCESS_ABOVE; fy++) {
      const y = fy - box.y0
      if (y < 0 || y >= H) continue
      const v = out[(y * W + x) * D + z]
      if (v < best) best = v
    }
    return best
  }
}

export function * planFloorSteps ({ read, home, start = null, entities = [], keepOut = [], skip = new Set(), cold = new Set(), maxSteps = FLOOR_STEPS_PER_VISIT, maxTries = FLOOR_MAX_TRIES } = {}) {
  const tally = { tried: 0, nostand: 0, nosupport: 0, seal: 0, sealwhy: {}, occupied: 0, skipped: 0 }
  if (typeof read !== 'function' || !home) return { steps: [], tally, why: 'no_home' }
  const r0 = memoRead(read)
  const placed = new Map()
  const world = overlay(r0, placed)
  const cls = floorCells(world, home, { keepOut })
  tally.cells = cls.tally
  if (cls.tally.unknown) return { steps: [], tally, why: 'unknown' }
  const st = start ?? startNear(world, home)
  if (!st) return { steps: [], tally, why: 'no_start' }
  const box = walkBox(home)
  const ents = Array.isArray(entities) ? entities.filter(Boolean) : []
  const occ = new Set()
  for (const e of ents) {
    const x = Math.floor(e.x), y = Math.floor(e.y), z = Math.floor(e.z)
    occ.add(K(x, y, z)); if (e.player) occ.add(K(x, y + 1, z))
  }
  let todo = cls.targets.filter(t => !skip.has(K(t.x, t.y, t.z)))
  tally.skipped = cls.targets.length - todo.length
  const steps = []
  let prev = st
  let dist = walkDist(world, st, { box, strict: true })              // where the BUILDER can go (strict)
  // A REFUSED CANDIDATE IS NOT RE-TRIED until a placement lands within 6 of it (its stand, support or seal can only
  // change through a nearby placement in this plan's view)
  const failedAt = new Map()
  const transient = new Set()                       // refused for a body or an item: never made cold (Claude r2 NEW-4)
  const skyCache = new Map()
  const near = (c, k) => { for (let i = k; i < steps.length; i++) { const p = steps[i].c; if (Math.max(Math.abs(p[0] - c.x), Math.abs(p[1] - c.y), Math.abs(p[2] - c.z)) <= 6) return true } return false }
  let why = null
  while (steps.length < maxSteps) {
    yield steps.length
    const access = accessIndex(dist, home)
    const backNow = walkBack(world, st, { box })      // every stand that walks to the town now: a fill must not cost one
    const eligible = []
    for (const t of todo) {
      if (!replaceable(world(t.x, t.y, t.z))) continue
      if (!fullFloor(world(t.x, t.y - 1, t.z))) continue
      const a = access(t)
      if (a === Infinity) continue
      eligible.push({ t, a })
    }
    // COLD cells (refused on an earlier visit: the record's) go LAST, ahead of the tier (Codex r4 P2: a cold platform cell
    // first would let refused tier-0 cells eat every visit's tries and starve the rest of the floor). The platform's
    // preference holds among the cells not yet refused; a refused cell is tried again once nothing untried is left, or
    // when it ages out (Claude r1 P2-2)
    const isCold = t => (cold.has(K(t.x, t.y, t.z)) ? 1 : 0)
    eligible.sort((p, q) => isCold(p.t) - isCold(q.t) || p.t.tier - q.t.tier || q.t.y - p.t.y || q.a - p.a || K(p.t.x, p.t.y, p.t.z) - K(q.t.x, q.t.y, q.t.z))
    if (!eligible.length) { why = 'none_reachable'; break }
    let took = null, tookDist = null
    let tries = 0, exhausted = false
    for (const { t } of eligible) {
      const key = K(t.x, t.y, t.z)
      const f = failedAt.get(key)
      if (f !== undefined && !near(t, f)) continue
      if (tries++ >= maxTries) { exhausted = true; break }
      if (tries > 1) yield steps.length                        // one candidate per slice: a live bot's event loop runs between them
      tally.tried++
      const fail = w => { tally[w] = (tally[w] ?? 0) + 1; failedAt.set(key, steps.length); if (w === 'occupied') transient.add(key) }
      if (occ.has(key)) { fail('occupied'); continue }
      const sup = floorSupports(world, t)
      if (!sup.length) { fail('nosupport'); continue }
      const options = sup.map(s => ({ ...s, point: faceCentre(s.ref, s.face), topFace: s.face[1] === 1 }))
      if (!options.some(o => standFor(world, { target: t, point: o.point, topFace: o.topFace, reach: dist }))) { fail('nostand'); continue }
      const sw = sealRefusal(world, t, { home, entities: ents, skyCache, skyRead: read })
      if (sw) { tally.sealwhy[sw] = (tally.sealwhy[sw] ?? 0) + 1; fail(sw === 'entity' ? 'occupied' : 'seal'); continue }
      placed.set(key, PLACED)
      const back = walkBack(world, st, { box })                         // every way a body walks home (permissive)
      const backB = walkBack(world, st, { box, strict: true })          // the builder's own way home (strict)
      placed.delete(key)
      // NO WAY IS CUT (Codex r1 P1): every stand that walked to the town before still does after, the filled cell's own
      // excepted -- whoever stands there (another bot, one coming up from the mines) or will stand there later
      if (lostWay(backNow, back, key) != null) { fail('cut'); continue }
      const usable = { has: k => dist.has(k) && backB.has(k) }
      let stand = null, opt = null
      for (const o of options) {
        stand = standFor(world, { target: t, point: o.point, topFace: o.topFace, reach: usable, prefer: prev })
        if (stand) { opt = o; break }
      }
      if (!stand) { fail('nostand'); continue }
      took = { c: [t.x, t.y, t.z], r: [opt.ref.x, opt.ref.y, opt.ref.z], f: opt.face, s: [stand.x, stand.y, stand.z], tier: t.tier }
      placed.set(key, PLACED)
      tookDist = walkDist(world, st, { box, strict: true })
      break
    }
    // the search ran out of tries: not "nothing can be done" (no hold), only "not on this visit"
    if (!took) { why = exhausted ? 'search_budget' : 'none_feasible'; break }
    steps.push(took)
    todo = todo.filter(t => !(t.x === took.c[0] && t.y === took.c[1] && t.z === took.c[2]))
    prev = { x: took.s[0], y: took.s[1], z: took.s[2] }
    dist = tookDist
  }
  if (!why && steps.length >= maxSteps) why = 'budget'
  // the cells refused this plan and never placed: the record makes them cold for the next visits
  const placedKeys = new Set(steps.map(q => K(q.c[0], q.c[1], q.c[2])))
  const refusedKeys = [...failedAt.keys()].filter(k => !placedKeys.has(k) && !transient.has(k))
  return { steps, tally, why, start: st, left: todo.length, refusedKeys }
}

/** A WAY LOST -> the first stand (cellKey) that walked to the town before a fill and does not after it, the filled cell's
 *  own excepted; null when none is. Pure. */
export function lostWay (before, after, filled) {
  for (const k of before) if (k !== filled && !after.has(k)) return k
  return null
}

/**
 * IS THIS STEP STILL GOOD IN THE WORLD AS IT IS NOW? -> null (yes) | reason. Pure; asked again at the click's turn (the
 * world moves between planning and clicking: another bot, a gatherer, a falling block):
 *   the cell is still replaceable, the block below still solid, the ref still usable, nothing protected by now (a chest
 *   placed beside it, a sapling planted), no hazard (cellHazard), the stand standable and in reach with a clear line of
 *   sight, and after the placement nothing is sealed, the stand still walks to `start`, and no other stand that walked to
 *   `start` before stops doing so. `cheap`: the local checks only (the skill's pre-check before it walks).
 */
export function stepRefusal (read0, step, { home, start, entities = [], keepOut = [], cheap = false } = {}) {
  if (!step?.c || !step.r || !step.f || !step.s || !start) return 'incomplete'
  const read = memoRead(read0)                     // one judgement reads each cell once (Claude r1 P2-3)
  const [x, y, z] = step.c
  const t = { x, y, z }
  const c = read(x, y, z)
  if (!c) return 'unknown'
  if (!replaceable(c)) return solid(c) ? 'filled' : `not_replaceable:${c.name}`
  if (!fullFloor(read(x, y - 1, z))) return 'no_floor'
  if (!refUsable(read(step.r[0], step.r[1], step.r[2]))) return 'ref'
  // protection is re-judged locally (a chest or a sapling may have appeared since the plan)
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
    const b = read(x + dx, y + dy, z + dz)
    if (b && isFurniture(b.name)) return 'furniture'
  }
  for (let u = 1; u <= 7; u++) { const b = read(x, y - u, z); if (!b) break; if (SAPLING.test(b.name ?? '')) return 'sapling'; if (solid(b)) break }
  for (let d = 1; d <= FLOOR_DEPTH + 2; d++) { const b = read(x, y - d, z); if (!b) break; if (isLiquid(b)) return 'over_liquid'; if (solid(b)) break }
  if (read(x, y - 1, z)?.name === 'farmland') return 'farmland'
  for (const o of (Array.isArray(keepOut) ? keepOut : [])) {
    const r = Number.isFinite(o?.r) ? o.r : 1, up = Number.isFinite(o?.up) ? o.up : r, down = Number.isFinite(o?.down) ? o.down : r
    if (o && Math.abs(x - o.x) <= r && Math.abs(z - o.z) <= r && y >= o.y - down && y <= o.y + up) return 'keepout'
  }
  for (const e of (Array.isArray(entities) ? entities : [])) {
    if (!e) continue
    const ex = Math.floor(e.x), ey = Math.floor(e.y), ez = Math.floor(e.z)
    if (ex === x && ez === z && (ey === y || (e.player && ey + 1 === y))) return 'occupied'
  }
  const [sx, sy, sz] = step.s
  if (!builderStand(read, sx, sy, sz)) return 'stand'
  if (sx === x && sz === z && (sy === y || sy + 1 === y || sy - 1 === y)) return 'stand_in_target'
  const point = faceCentre({ x: step.r[0], y: step.r[1], z: step.r[2] }, step.f)
  const eye = { x: sx + 0.5, y: sy + EYE_HEIGHT, z: sz + 0.5 }
  if (step.f[1] === 1 && eye.y <= point.y + 1e-9) return 'below_face'
  if (Math.hypot(eye.x - point.x, eye.y - point.y, eye.z - point.z) > FLOOR_REACH) return 'reach'
  if (!sightClear(read, eye, point, K(x, y, z))) return 'sight'
  const hz = cellHazard(read, x, y, z)
  if (hz) return hz
  // CHEAP (the pre-check before the walk): the local judgement only; the click's own check runs everything below
  if (cheap) return null
  const sw = sealRefusal(read, t, { home, entities, skyRead: read0 })
  if (sw) return `seal:${sw}`
  const after = overlay(read, new Map([[K(x, y, z), PLACED]]))
  const box = walkBox(home)
  const backAfter = walkBack(after, start, { box })
  if (!walkBack(after, start, { box, strict: true }).has(K(sx, sy, sz))) return 'walled_in'
  // NO WAY IS CUT, judged again now (Codex r1 P1: a bot that walked in after the plan is protected at the click)
  if (lostWay(walkBack(read, start, { box }), backAfter, K(x, y, z)) != null) return 'cut'
  return null
}

// ---- funding ------------------------------------------------------------------------------------------------------------

const cobbleOf = list => list.reduce((n, it) => n + (COBBLE.has(it.name) ? (Number(it.count) || 0) : 0), 0)
/**
 * THE BLOCK TO PLACE NEXT from this bag -> name | null. Pure. FLOOR_BLOCKS in order: the decorations (andesite, diorite,
 * granite: the well's junk) whenever held; the cobble only while the bag keeps COBBLE_RESERVE (64) cobble after it.
 */
export function floorBlockFor (items = []) {
  const list = (Array.isArray(items) ? items : []).filter(it => it?.name && (Number(it.count) || 0) > 0)
  for (const name of FLOOR_BLOCKS) {
    const it = list.find(x => x.name === name)
    if (!it) continue
    if (COBBLE.has(name) && cobbleOf(list) - 1 < COBBLE_RESERVE) continue
    return name
  }
  return null
}
/** How many floor blocks this bag can spend -> n >= 0. Pure. */
export function floorBudget (items = [], cap = 9999) {
  const list = (Array.isArray(items) ? items : []).filter(it => it?.name && (Number(it.count) || 0) > 0)
  let deco = 0
  for (const it of list) if (FLOOR_BLOCKS.includes(it.name) && !COBBLE.has(it.name)) deco += Number(it.count)
  return Math.max(0, Math.min(cap, deco + Math.max(0, cobbleOf(list) - COBBLE_RESERVE)))
}

// ---- the record, the lease and the order --------------------------------------------------------------------------------

/**
 * WHO HOLDS THE TOWN'S FLOOR JOB -> { free, mine, holder, leftMs }. Pure (plinth.mjs leaseState). An expired lease is
 * free; a lease stamped in the future (> 60 s) too. `me` is the holder's TOKEN (one per acquisition): the same username on
 * a new connection is not the holder.
 */
export function leaseState (lease, now = 0, me = null) {
  const until = Number(lease?.until), at = Number(lease?.at)
  if (!lease || !Number.isFinite(until) || until <= now || (Number.isFinite(at) && at > now + 60_000)) return { free: true, mine: false, holder: null, leftMs: 0 }
  if (me != null && lease.token === me) return { free: true, mine: true, holder: lease.by ?? null, leftMs: until - now }
  return { free: false, mine: false, holder: lease.by ?? '?', leftMs: until - now }
}

/** Is this record this world's, at this version? -> the record | null. Pure (a reseeded world starts a fresh record). */
export function floorRecordFor (rec, world = null) {
  if (!rec || typeof rec !== 'object' || rec.v !== FLOOR_VERSION || !sameWorld(rec.world ?? null, world)) return null
  return rec
}

/** The cells to skip: those the server dropped STUCK_TRIES times, within STUCK_HOLD_MS. Pure. -> Set of cellKey. */
export function stuckSkips (rec, now = 0) {
  const out = new Set()
  for (const [k, v] of Object.entries(rec?.stuck ?? {})) {
    if ((Number(v?.n) || 0) >= STUCK_TRIES && now - (Number(v?.at) || 0) < STUCK_HOLD_MS) out.add(Number(k))
  }
  return out
}
/** The cold set from the record (cells refused at planning within STUCK_HOLD_MS) -> Set of cellKey. Pure. */
export function coldKeys (rec, now = 0) {
  const out = new Set()
  for (const [k, at] of Object.entries(rec?.cold ?? {})) if (now - (Number(at) || 0) < STUCK_HOLD_MS) out.add(Number(k))
  return out
}
/** The cold map after a visit -> new map: this visit's refused keys stamped now, old ones kept until they age out, placed
 *  ones dropped; at most COLD_MAX entries (the newest). Pure. */
export const COLD_MAX = 4000
export function coldAfter (cold = {}, refused = [], placed = [], now = 0) {
  const m = {}
  for (const [k, at] of Object.entries(cold ?? {})) if (now - (Number(at) || 0) < STUCK_HOLD_MS) m[k] = Number(at)
  for (const k of refused) m[String(k)] = now
  for (const k of placed) delete m[String(k)]
  const ent = Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, COLD_MAX)
  return Object.fromEntries(ent)
}

/** The stuck map after a click's read-back -> new map. Pure: a success forgets the cell, a drop counts it; old entries go. */
export function stuckAfter (stuck = {}, key, ok, now = 0) {
  const s = {}
  for (const [k, v] of Object.entries(stuck ?? {})) if (now - (Number(v?.at) || 0) < STUCK_HOLD_MS) s[k] = v
  if (ok) delete s[key]
  else s[key] = { n: (Number(s[key]?.n) || 0) + 1, at: now }
  return s
}

/**
 * THE FLOOR ORDER -> { order, state }. Pure; cognitive.mjs supplies the readings and keeps `state`.
 *   zone       the town-ground zone is in this build (zoneLive): without it the fill is dug back out, so never
 *   distHome   at town (TOWN_RADIUS horizontally, and within FLOOR_DEPTH + 6 of home's height), never a trip
 *   inside     inside a junk well: never
 *   budget     blocks this bag can spend (floorBudget) -- a visit needs FLOOR_MIN_FUND
 *   lease      () -> leaseState (another builder holds the town: wait)
 *   held       () -> true when the town's record holds the job back (no work found within FLOOR_NONE_BACKOFF_MS)
 * The world is never scanned here: the skill plans. Cooldown FLOOR_COOLDOWN_MS between two orders of one bot.
 */
export function floorOrder ({ now = 0, distHome = Infinity, dy = 0, zone = true, inside = false, budget = 0, lease = null, held = false, state = {} } = {}) {
  const s = { ...state }
  const none = () => ({ order: null, state: s })
  if (!zone) return none()
  if (!(distHome <= TOWN_RADIUS)) return none()
  // AT TOWN means near its floor too (Claude r1 P3-10): a bot deep in a mine under the town is not at town
  if (!(Math.abs(dy) <= FLOOR_DEPTH + 6)) return none()
  if (now - (s.lastAt ?? -Infinity) < FLOOR_COOLDOWN_MS || now < (s.backoffUntil ?? 0)) return none()
  const lz = v => (typeof v === 'function' ? v() : v)
  const b = Number(lz(budget)) || 0
  if (b < FLOOR_MIN_FUND) return none()
  if (lz(inside)) return none()
  if (lz(held)) return none()
  const l = lz(lease)
  if (l && !l.free) return none()
  s.lastAt = now
  return { order: { skill: 'fill_town', args: {}, why: `the town floor is dug out; ${b} block(s) of surplus to fill it with` }, state: s }
}

/** After a fill_town ran -> the new state. A skip or an abort costs nothing; nothing to do holds an hour; a fault backs off. */
export function floorOrderOutcome (status, now = 0, state = {}, failClass = null) {
  const s = { ...state }
  if (status === 'success') { s.backoffUntil = 0; return s }
  if (status === 'no_effect' && failClass === 'floor_none') { s.backoffUntil = Math.max(s.backoffUntil ?? 0, now + FLOOR_NONE_BACKOFF_MS); return s }
  if (status !== 'failed') return s
  s.backoffUntil = now + (failClass === 'floor_lease' ? FLOOR_COOLDOWN_MS : FLOOR_BACKOFF_MS)
  return s
}

/** Does the town's record hold the job back? (a visit found no reachable target within FLOOR_NONE_BACKOFF_MS) Pure. */
export function floorHeld (rec, now = 0) {
  if (rec?.noneAt == null) return false
  const at = Number(rec.noneAt)
  return Number.isFinite(at) && at <= now + 60_000 && now - at < FLOOR_NONE_BACKOFF_MS
}

/**
 * THE EVIDENCE A STEP ROW CARRIES for the read's own judge (townfloorread.py re-derives "protected" from it, independent
 * of this file's decision) -> { nb, col }. Pure.
 *   nb   every neighbour within Chebyshev 1 (3D) that is neither open nor plain terrain: `name@dx,dy,dz`, ';'-joined
 *   col  the cells below, from y-1 down: names until the first solid that is not leaves (inclusive), at most 8
 */
const PLAIN = /^(air|cave_air|void_air|short_grass|tall_grass|fern|large_fern|dead_bush|stone|cobblestone|mossy_cobblestone|stone_bricks|deepslate|cobbled_deepslate|andesite|diorite|granite|tuff|calcite|dirt|coarse_dirt|rooted_dirt|grass_block|podzol|gravel|sand|clay|[a-z_]+_ore)$/
export function stepEvidence (read, c) {
  const nb = []
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
    if (!dx && !dy && !dz) continue
    const b = read(c.x + dx, c.y + dy, c.z + dz)
    const n = b?.name ?? 'unloaded'
    if (!PLAIN.test(n)) nb.push(`${n}@${dx},${dy},${dz}`)
  }
  const col = []
  for (let d = 1; d <= 8; d++) {
    const b = read(c.x, c.y - d, c.z)
    col.push(b?.name ?? 'unloaded')
    if (!b || (solid(b) && !/_leaves$/.test(b.name ?? ''))) break
  }
  return { nb: nb.join(';') || '-', col: col.join(',') }
}

/** THE _town_floor ROW, key=value, stage first (the read parses fields): cut at 300. */
export function floorDetail ({ stage, placed = 0, planned = 0, refused = 0, dropped = 0, budget = null, spent = 0, left = null, tier0 = 0,
                               why = null, block = null, tally = null, ms = null } = {}) {
  return (`stage=${stage} placed=${placed} planned=${planned} refused=${refused} dropped=${dropped} spent=${spent} tier0=${tier0}` +
          `${budget != null ? ` budget=${budget}` : ''}${left != null ? ` left=${left}` : ''}${block ? ` block=${block}` : ''}` +
          `${ms != null ? ` ms=${ms}` : ''}${tally ? ` tally=${tally}` : ''}${why ? ` why=${String(why).replace(/\s+/g, '_').slice(0, 100)}` : ''}`).slice(0, 300)
}

export const isFloorBlock = name => FLOOR_BLOCKS.includes(name)
export { TOWN_RADIUS }
