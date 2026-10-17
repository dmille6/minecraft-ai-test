// THE RAISED JUNK WELL (plinth-01; OWNER 10-13 "yes do 2-4"): a town whose ground no longer seals a well builds the seal.
//
// WHY. The junk well is accepted only where the ground seals it (well.mjs containmentRefusal: the 8 walls at g and g-1,
// a 5x5 ring at g-1..g-3, a solid floor). The bots dug out the ground within ~15 of every home: on 10-13 the walls or the
// ring failed on 80-100% of candidate cells in all 16 towns, and 13 of 16 towns could not site a well at all
// (docs/reports/townground-2026-10-13.md section 3; wellsite-selfbuild-design-2026-10-13.md).
//
// THE IDEA. Keep the verified geometry EXACTLY and supply what the world is missing with blocks the bot places itself: a
// placed cobblestone is a full, non-falling cube, which is all the rule asks of a shell cell. So the oracle is unchanged:
// a plan is accepted only if wellSiteRefusal says null of the world WITH the plan applied, and the built well is checked by
// the same containmentRefusal before every throw, like any other.
//
// THE SHELL for a cap at g (raised k above the column's surface t, g = t + k, k = 0..PLINTH_MAX_RAISE):
//   g    3x3 minus the cap                     (8)    the walls the thrower stands on (feet g+1)
//   g-1  5x5 minus the shaft                   (24)   walls + the ring
//   g-2  5x5, the floor included               (25)
//   g-3  5x5 minus the centre                  (24)   81 in all for a full raise
// The cap and the shaft stay OPEN (or natural diggable ground at k = 0..1, which build_well digs as it does today).
//
// EVERY BLOCK IS PLACED, never dug (no rejected-dig ghost risk), except leaves in a cell the plan needs (no tool, and the
// town-ground zone leaves vegetation alone): those are cleared first (the leaf-clear list). Each placement clicks the TOP
// face of the block below or a SIDE face of a neighbour -- never a bottom face -- from a STAND the bot can walk to in the
// world as it is at that step (walkReach from the town), within PLINTH_REACH of the face with a clear line of sight, and
// the stand stays connected to the town after the placement. A one-wide stair is part of the plan when the top cannot be
// walked to otherwise.
//
// A HALF-BUILT PLINTH IS A BLOCK OF COBBLE, except from the placement that walls the column in (plinthHazard: a body at
// the bottom of the open column can neither walk nor step out). The plan records which step that is; the builder owns the
// pit from just before it (a cover block in the bag, the well_pit_dug row) and covers the cap cell if it cannot finish, and
// any visitor covers an uncovered hazard (close_well). The planner proves a cover CAN be placed in every hazardous state.
//
// Nothing here touches the world or the disk: skills.mjs supplies read(), the records and the clicks.

import { fullCube, wellGround, wellPassable, wellSiteRefusal, wellStand, coverRef, wellSpiral, pitCoverItem, reserveStone, PIT_COVER_BLOCKS,
         STONE_GUARD, RESERVE_STONE, WELL_HOME_CLEARANCE, WELL_NO_SITE_BACKOFF_MS, WELL_BUILD_BACKOFF_MS, WELL_SCAN_MS } from './well.mjs'
import { townDistance, ADOPT_RADIUS, TOWN_RADIUS, CLEARANCE_CONTAINER, sameWorld, tableCellFor, bodyInCell, PLACEABLE_INTO } from './composter.mjs'
// plinthfirst-01: the evidence that a finished raised well is lost (its own statement)
import { wellStage as pfWellStage, containmentRefusal as pfContainment } from './well.mjs'

export const PLINTH_VERSION = 1
/**
 * THE LICENCE ROW (plinth-02): written once per spawn by index.mjs as the build's own `_plinth_mode` kind. A town whose plinth
 * was finished under plinth-01 (board-c, hive-d) writes no `_plinth` row at all -- the build order wants nothing -- so a licence
 * on `_plinth` alone could not see this build live there; neither the base nor plinth-01 writes this kind. It carries the
 * world (`w=`, as the no_site rows do, cut at 40): the read takes a plinth RECORD as this world's only on that evidence.
 */
export const plinthModeDetail = (worldId = null) => `phase=mode v=2 table=below_stand w=${String(worldId || '-').slice(0, 40)}`
/** The highest raise: g-3 = t+1 at k = 4, so no shell cell is ever below the surface. */
export const PLINTH_MAX_RAISE = 4
/** Eye to the clicked face's centre (vanilla's block_interaction_range; the server allows a margin beyond it). */
export const PLINTH_REACH = 4.5
export const EYE_HEIGHT = 1.62
/** At most this many candidate (column, raise) pairs are sequenced per plan (the costly part): cheapest first. */
export const PLINTH_MAX_TRIES = 40
/** ...and the cheapest total of the first few plans found wins (a stair can make the cheapest shell the dearest plan). */
export const PLINTH_MAX_FOUND = 4
/** A plan's total: blocks placed, and leaf clears at half weight. */
export const plinthTotal = plan => plan.cost + 0.5 * plan.clears
/** Placements per visit, at most (a visit is bounded like every town order; the rest is the next visit's). */
export const PLINTH_STEPS_PER_VISIT = 40
/** A visit starts only with at least this many blocks to spend (or a chest to take them from). */
export const PLINTH_MIN_FUND = 8
/** One builder per town: the lease is held this long and renewed at every placement. */
export const PLINTH_LEASE_MS = 4 * 60 * 1000
/** Between two plinth orders of one bot (production 5 min; the sandbox paces it with PLINTH_COOLDOWN_MS, as build_well's
 *  record settle has WELL_RECORD_SETTLE_MS). */
export const PLINTH_COOLDOWN_MS = Number.isFinite(Number(process.env.PLINTH_COOLDOWN_MS)) && process.env.PLINTH_COOLDOWN_MS !== '' ? Number(process.env.PLINTH_COOLDOWN_MS) : 5 * 60 * 1000
export const PLINTH_BACKOFF_MS = WELL_BUILD_BACKOFF_MS
/** A town where the planner found no plan is not planned again for this long (the ground rarely improves). */
export const PLINTH_NONE_BACKOFF_MS = WELL_NO_SITE_BACKOFF_MS
/** The blocks a plinth is built from, used first first: the decorations the well would otherwise take, then the stone. */
export const PLINTH_BLOCKS = Object.freeze(['andesite', 'diorite', 'granite', 'cobbled_deepslate', 'cobblestone'])
const PLINTH_SET = new Set(PLINTH_BLOCKS)

/** Cells a block may be placed INTO (the composter's verified set, plus the two-high grasses). Flowers, saplings and torches
 *  are NOT replaceable in vanilla: a plan through one is refused (breaking them is a dig the plan does not make). */
export const PLINTH_REPLACEABLE = new Set(['air', 'cave_air', 'void_air', 'short_grass', 'fern', 'dead_bush', 'tall_grass', 'large_fern'])
const LEAVES = /_leaves$/
const LIQUID = /^(water|lava|flowing_water|flowing_lava|bubble_column)$/
/** Town furniture no planned cell may touch (Chebyshev 1, 3D): a lid must open, a door must swing, a bed must be slept in. */
const FURNITURE = /(_door$|_bed$|^lectern$|^bell$|^crafting_table$|^composter$|^cartography_table$|^smithing_table$|^loom$|^grindstone$|^stonecutter$|^anvil$)/
const isFurniture = name => CLEARANCE_CONTAINER.test(name ?? '') || FURNITURE.test(name ?? '')
/** Town furniture within Chebyshev 1 (3D) of a cell -> its block name, or null. Pure over read(). An unknown cell is no evidence of
 *  furniture here (the planner refuses unknown cells on its own). */
export function furnitureNear (read, x, y, z) {
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
    const b = read(x + dx, y + dy, z + dz)
    if (b && isFurniture(b.name)) return b.name
  }
  return null
}

/** The block a plan places, as read() would return it (a full collision cube, hardness 2). */
export const PLACED = Object.freeze({ name: 'cobblestone', boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]], hardness: 2, props: null })
export const AIR = Object.freeze({ name: 'air', boundingBox: 'empty', shapes: [], hardness: 0, props: null })

/** A cell's key: one exact number (|x|,|z| < 2^20, -512 <= y < 512), so the hot maps and sets never build strings. */
export const cellKey = (x, y, z) => ((x + 1048576) * 2097152 + (z + 1048576)) * 1024 + (y + 512)
const K = cellKey
const solid = b => !!b && b.boundingBox === 'block'
const passable = wellPassable
const ground = wellGround
const replaceable = b => !!b && PLINTH_REPLACEABLE.has(b.name)
const FACES = Object.freeze([[0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]])   // ref offsets: below, then the four sides
const CARD = Object.freeze([[1, 0], [-1, 0], [0, 1], [0, -1]])

/** An overlay on read(): `cells` (Map key -> block) wins. Pure. */
export function overlay (read, cells) {
  return (x, y, z) => { const k = K(x, y, z); return cells.has(k) ? cells.get(k) : read(x, y, z) }
}
/** read() memoised (a world view that does not change during one plan). With `around` ({x,y,z}), the cells within 48
 *  horizontally and 32 vertically live in a flat array (the planner reads them millions of times); the rest in a Map. */
export function memoRead (read, around = null) {
  const m = new Map()
  const R = 48, H = 32
  const grid = around ? new Array((2 * R + 1) * (2 * R + 1) * (2 * H + 1)) : null
  const ox = around ? Math.floor(around.x) - R : 0, oy = around ? Math.floor(around.y) - H : 0, oz = around ? Math.floor(around.z) - R : 0
  const W2 = 2 * R + 1, HH = 2 * H + 1
  return (x, y, z) => {
    if (grid) {
      const ix = x - ox, iy = y - oy, iz = z - oz
      if (ix >= 0 && ix < W2 && iz >= 0 && iz < W2 && iy >= 0 && iy < HH) {
        const i = (ix * W2 + iz) * HH + iy
        let v = grid[i]
        if (v === undefined) { v = read(x, y, z); grid[i] = v }
        return v
      }
    }
    const k = K(x, y, z); if (m.has(k)) return m.get(k); const v = read(x, y, z); m.set(k, v); return v
  }
}

// ---- the geometry ----------------------------------------------------------------------------------------------------

/** The cells the oracle requires SOLID for a cap -> [{ x, y, z, role }] ('wall' | 'ring' | 'floor'), bottom layer first. */
export function plinthShell (cap) {
  const { x, y: g, z } = cap, out = []
  for (const dy of [-3, -2, -1, 0]) {
    const r = dy === 0 ? 1 : 2
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (!dx && !dz && dy !== -2) continue
        const role = !dx && !dz ? 'floor' : (Math.max(Math.abs(dx), Math.abs(dz)) === 1 && dy >= -1) ? 'wall' : 'ring'
        out.push({ x: x + dx, y: g + dy, z: z + dz, role })
      }
    }
  }
  return out
}
/** The cap and the shaft: open, or natural diggable ground build_well digs (k = 0..1). */
export const plinthColumn = cap => [{ x: cap.x, y: cap.y, z: cap.z }, { x: cap.x, y: cap.y - 1, z: cap.z }]
/** Above the cap: open (wellSiteRefusal 'not open above'). */
export const plinthAbove = cap => [{ x: cap.x, y: cap.y + 1, z: cap.z }, { x: cap.x, y: cap.y + 2, z: cap.z }]
/** No body ever stands in the well column (well.mjs WELL_COLUMN_UP: every movement profile prices it out). */
export const inColumn = (cap, x, y, z) => x === cap.x && z === cap.z && y >= cap.y - 1 && y <= cap.y + 10

/**
 * WHAT A REQUIRED-SOLID CELL NEEDS -> 'keep' | 'fill' | 'leaf' | 'refuse' | 'unknown'. Pure.
 * keep: already ground (natural or placed). fill: replaceable. leaf: leaves, cleared then filled (when allowed).
 * refuse: anything else (sand, a log, a chest, a sapling, a liquid, a trapdoor). unknown: not loaded (never on a guess).
 */
export function shellClass (b, { clearLeaves = true } = {}) {
  if (!b) return 'unknown'
  if (ground(b)) return 'keep'
  if (replaceable(b)) return 'fill'
  if (clearLeaves && LEAVES.test(b.name ?? '')) return 'leaf'
  return 'refuse'
}

/** The column's surface: the ground under the highest open cell on a solid floor, within home.y +- 8 (the well search's). */
export function columnSurface (read, x, z, hy, { throughLeaves = false } = {}) {
  const open = b => passable(b) || (throughLeaves && LEAVES.test(b.name ?? ''))
  for (let y = hy + 8; y >= hy - 8; y--) {
    const cell = read(x, y, z), under = read(x, y - 1, z)
    if (!cell || !under) return null
    // THROUGH LEAVES (a planted canopy over the town, placebo-c 10-13): the surface is the ground under it, not the canopy
    if (open(cell) && solid(under) && !(throughLeaves && LEAVES.test(under.name ?? ''))) return y - 1
  }
  return undefined
}

// ---- walking: the probe that stands in for the pathfinder ------------------------------------------------------------

/** Can a body stand with its feet here? feet and head open (no liquid), a solid floor. Pure. */
export function standable (read, x, y, z) {
  return passable(read(x, y, z)) && passable(read(x, y + 1, z)) && solid(read(x, y - 1, z))
}

/**
 * EVERY FEET CELL REACHABLE ON FOOT FROM `start` -> Set of cellKey. Pure. A conservative stand-in for the pathfinder: the
 * four cardinal moves -- walk, step up 1 (head room above the origin), drop 1..3 -- within `box`, never a `forbid` cell
 * (the well column), no digging, no placing, no swimming, no diagonal. A cell it reaches the pathfinder can reach; the
 * converse is not claimed (the sandbox measures the real pathfinder, S3).
 */
export function walkReach (read, start, { box, forbid = () => false, maxNodes = 80_000, until = null } = {}) {
  const seen = new Set()
  if (!start || !standable(read, start.x, start.y, start.z)) return seen
  const inBox = (x, y, z) => !box || (x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1 && z >= box.z0 && z <= box.z1)
  const ok = (x, y, z) => inBox(x, y, z) && !forbid(x, y, z) && standable(read, x, y, z)
  const q = [[start.x, start.y, start.z]]
  seen.add(K(start.x, start.y, start.z))
  const push = (x, y, z) => { const k = K(x, y, z); if (!seen.has(k)) { seen.add(k); q.push([x, y, z]) } }
  for (let i = 0; i < q.length && seen.size < maxNodes; i++) {
    if (until != null && seen.has(until)) break                 // a probe for one cell stops when it is found
    const [x, y, z] = q[i]
    for (const [dx, dz] of CARD) {
      const nx = x + dx, nz = z + dz
      if (ok(nx, y, nz)) { push(nx, y, nz); continue }
      // step up: the neighbour's feet cell is solid, the body rises into y+1 (head room above the origin too)
      if (solid(read(nx, y, nz)) && passable(read(x, y + 2, z)) && ok(nx, y + 1, nz)) { push(nx, y + 1, nz); continue }
      // walk off and drop 1..3
      if (!inBox(nx, y, nz) || forbid(nx, y, nz) || !passable(read(nx, y, nz)) || !passable(read(nx, y + 1, nz))) continue
      for (let d = 1; d <= 3; d++) {
        const fy = y - d
        if (forbid(nx, fy, nz) || !passable(read(nx, fy, nz))) break
        if (solid(read(nx, fy - 1, nz))) { if (ok(nx, fy, nz)) push(nx, fy, nz); break }
      }
    }
  }
  return seen
}

/**
 * EVERY FEET CELL FROM WHICH A BODY WALKS TO `target` -> Set of cellKey. Pure. walkReach run backwards: each cell's
 * predecessors under exactly walkReach's moves (a walk, a step up of 1 with head room, a drop of 1..3 down a clear column),
 * so `walkReachBack(r, t).has(c)` iff `walkReach(r, c).has(t)` (a property test checks it). One search answers "can this
 * stand walk back to the town?" for every stand at once (Codex r2 P1-1, without a search per stand).
 */
export function walkReachBack (read, target, { box, forbid = () => false, maxNodes = 80_000 } = {}) {
  const seen = new Set()
  if (!target || !standable(read, target.x, target.y, target.z)) return seen
  const inBox = (x, y, z) => !box || (x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1 && z >= box.z0 && z <= box.z1)
  const ok = (x, y, z) => inBox(x, y, z) && !forbid(x, y, z) && standable(read, x, y, z)
  const q = [[target.x, target.y, target.z]]
  seen.add(K(target.x, target.y, target.z))
  const push = (x, y, z) => { const k = K(x, y, z); if (!seen.has(k)) { seen.add(k); q.push([x, y, z]) } }
  for (let i = 0; i < q.length && seen.size < maxNodes; i++) {
    const [x, y, z] = q[i]                                   // B: a cell known to reach the target
    for (const [dx, dz] of CARD) {
      const ax = x - dx, az = z - dz                        // A moves along +d onto B's column
      // walk A(y) -> B(y): A standable; B standable (it is)
      if (ok(ax, y, az)) push(ax, y, az)
      // step up A(y-1) -> B(y): B's floor is A's same-level neighbour (solid), head room above A
      if (ok(ax, y - 1, az) && passable(read(ax, y + 1, az))) push(ax, y - 1, az)
      // drop A(y+d) -> B(y), d = 1..3: B's column clear from y to y+d+1 (the walk-off cell and its head, then the fall)
      for (let d = 1; d <= 3; d++) {
        const ya = y + d
        let clear = true
        for (let c = y; c <= ya + 1; c++) { if (!inBox(x, c, z) && c >= ya || forbid(x, c, z) || !passable(read(x, c, z))) { clear = false; break } }
        if (!clear) break
        if (ok(ax, ya, az)) push(ax, ya, az)
      }
    }
  }
  return seen
}

/** The standable feet cell nearest home (within 4 horizontally, home.y +- 3), or null: where the probe starts. Pure. */
export function startNear (read, home) {
  let best = null
  const hy = Math.floor(home.y)
  for (let dx = -4; dx <= 4; dx++) {
    for (let dz = -4; dz <= 4; dz++) {
      for (let dy = -3; dy <= 3; dy++) {
        const x = Math.floor(home.x) + dx, y = hy + dy, z = Math.floor(home.z) + dz
        if (!standable(read, x, y, z)) continue
        const d = dx * dx + dz * dz + 2 * dy * dy
        if (!best || d < best.d || (d === best.d && K(x, y, z) < K(best.x, best.y, best.z))) best = { x, y, z, d }
      }
    }
  }
  return best ? { x: best.x, y: best.y, z: best.z } : null
}

// ---- one click ---------------------------------------------------------------------------------------------------------

/** The centre of the face of `ref` that looks along `face` (the click point). */
export const faceCentre = (ref, face) => ({ x: ref.x + 0.5 + face[0] * 0.5, y: ref.y + 0.5 + face[1] * 0.5, z: ref.z + 0.5 + face[2] * 0.5 })

/**
 * IS THE LINE FROM THE EYE TO A POINT CLEAR? Pure. Every cell the segment passes through (sampled every 0.05, the last
 * 2% excluded: that is the clicked face itself) is open, or is one of `through` (the target cell the click looks into).
 */
export function sightClear (read, eye, point, through = new Set()) {
  const dx = point.x - eye.x, dy = point.y - eye.y, dz = point.z - eye.z
  const len = Math.hypot(dx, dy, dz)
  const n = Math.max(2, Math.ceil(len / 0.05))
  for (let i = 0; i <= n * 0.98; i++) {
    const t = i / n
    const x = Math.floor(eye.x + dx * t), y = Math.floor(eye.y + dy * t), z = Math.floor(eye.z + dz * t)
    const k = K(x, y, z)
    if (through.has(k)) continue
    const b = read(x, y, z)
    if (!b) return false
    if (b.boundingBox !== 'empty') return false
  }
  return true
}

/**
 * WHERE TO STAND FOR ONE CLICK -> { x, y, z } (feet) | null. Pure.
 *   target  the cell the click affects (the cell placed into, or the leaf dug)
 *   point   the clicked point (a face centre for a placement, the block centre for a dig)
 *   topFace true when the click is on a TOP face (the eye must be above it)
 *   reach   Set of reachable feet cellKeys (walkReach) -- only those are stands
 *   avoid   (x,y,z) -> true for a feet/head cell no stand may use (the well column)
 *   prefer  the previous stand: the nearest stand to it wins (less walking), then the lowest key
 * A stand never puts the body in the target cell (feet or head), and never needs a look through anything solid.
 */
export function standFor (read, { target, point, topFace = false, reach, avoid = () => false, prefer = null, radius = 5 }) {
  let best = null
  const through = new Set([K(target.x, target.y, target.z)])
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dy = -4; dy <= 3; dy++) {
        const x = target.x + dx, y = target.y + dy, z = target.z + dz
        const k = K(x, y, z)
        if (!reach.has(k)) continue
        if (avoid(x, y, z) || avoid(x, y + 1, z)) continue
        if (x === target.x && z === target.z && (y === target.y || y + 1 === target.y)) continue
        const eye = { x: x + 0.5, y: y + EYE_HEIGHT, z: z + 0.5 }
        if (topFace && eye.y <= point.y + 1e-9) continue
        if (Math.hypot(eye.x - point.x, eye.y - point.y, eye.z - point.z) > PLINTH_REACH) continue
        if (!sightClear(read, eye, point, through)) continue
        const d = prefer ? Math.hypot(x - prefer.x, y - prefer.y, z - prefer.z) : Math.hypot(dx, dy, dz)
        if (!best || d < best.d - 1e-9 || (Math.abs(d - best.d) <= 1e-9 && k < best.k)) best = { x, y, z, d, k }
      }
    }
  }
  return best ? { x: best.x, y: best.y, z: best.z } : null
}

/** The support faces for placing into `cell` -> [{ ref, face }]: the block BELOW (its top face) first, then the four
 *  sides; never the block above (a bottom-face click is never made). Only solid refs that are not liquids. Pure. */
export function supportsFor (read, cell) {
  const out = []
  for (const [dx, dy, dz] of FACES) {
    const ref = { x: cell.x + dx, y: cell.y + dy, z: cell.z + dz }
    if (!refUsable(read(ref.x, ref.y, ref.z))) continue        // one rule with the click's re-read (Claude r2 P3-3)
    out.push({ ref, face: [-dx || 0, -dy || 0, -dz || 0] })   // never -0 (a face is compared and stored)
  }
  return out
}

/** CAN A BODY AT `from` WALK BACK TO `to`? Pure. The walk is not symmetric (a drop of 3 is a move, a climb of 2 is not), so
 *  "the town reaches the stand" never proves "the stand reaches the town" (Codex r2 P1-1): asked in this direction. */
export function walksBack (read, from, to, { box = null, forbid = () => false } = {}) {
  if (!from || !to) return false
  return walkReach(read, from, { box, forbid, until: K(to.x, to.y, to.z) }).has(K(to.x, to.y, to.z))
}

/** May a click use this block as its support? Solid, not a liquid, and not a block a click would USE instead (a door, a
 *  trapdoor, a container: the click opens it). Pure; supportsFor's own rule, for a recorded ref read again at its turn. */
export function refUsable (b) {
  return solid(b) && !LIQUID.test(b.name ?? '') && !/_trapdoor$|_door$|^chest$|^trapped_chest$|^barrel$|_shulker_box$|^crafting_table$|furnace$|^smoker$|^hopper$|^lectern$/.test(b.name ?? '')
}

/**
 * IS THIS STAND GOOD FOR THIS CLICK, IN THE WORLD AS IT IS NOW? -> null (yes) | reason. Pure; the planner's own checks,
 * asked again at the click's turn of a recorded stand and of any substitute (Codex r1 P1-1, Claude r1 P2-2):
 *   standable, never in a forbidden column, never the target cell (feet or head), the eye within PLINTH_REACH of the
 *   point, a top face only from above, a clear line of sight -- and AFTER the click (the target placed or cleared) the
 *   stand still walks to `start` (the town): a click never walls its own builder in.
 */
export function standOk (read, { stand, target, point, topFace = false, op = 'place', start, box = null, forbid = () => false }) {
  if (!stand || !target || !point || !start) return 'incomplete'
  const { x, y, z } = stand
  if (!standable(read, x, y, z)) return 'not standable'
  if (forbid(x, y, z) || forbid(x, y + 1, z)) return 'in a well column'
  if (x === target.x && z === target.z && (y === target.y || y + 1 === target.y)) return 'in the target cell'
  if (x === target.x && z === target.z && y - 1 === target.y) return 'standing on the target'
  const eye = { x: x + 0.5, y: y + EYE_HEIGHT, z: z + 0.5 }
  if (topFace && eye.y <= point.y + 1e-9) return 'below the top face'
  if (Math.hypot(eye.x - point.x, eye.y - point.y, eye.z - point.z) > PLINTH_REACH) return 'out of reach'
  if (!sightClear(read, eye, point, new Set([K(target.x, target.y, target.z)]))) return 'no line of sight'
  const after = overlay(read, new Map([[K(target.x, target.y, target.z), op === 'clear' ? AIR : PLACED]]))
  if (!walksBack(after, stand, start, { box, forbid })) return 'walled in after the click'
  return null
}

/** After a click that walls the column in, can a cover still be placed from a stand that walks to `start`? Pure. */
export function coverableAfter (read, cap, { start, box = null, forbid = () => false }) {
  const cr = coverRef(read, cap, null)
  if (!cr) return false
  // a cover stand the town reaches AND that walks back to the town once the cover is in (Claude r3 P3-3: the cover's own
  // standOk asks both; the proof must not promise less)
  const there = walkReach(read, start, { box, forbid })
  const covered = overlay(read, new Map([[K(cap.x, cap.y, cap.z), PLACED]]))
  const back = walkReachBack(covered, start, { box, forbid })
  const reach = { has: k => there.has(k) && back.has(k) }
  return !!standFor(read, { target: cap, point: faceCentre(cr.ref, [cr.face.x, cr.face.y, cr.face.z]), topFace: cr.face.y === 1, reach, avoid: forbid })
}

// ---- the hazard --------------------------------------------------------------------------------------------------------

/**
 * CAN THE OPEN COLUMN TRAP OR HIDE A BODY? -> true | false | null (a cell not loaded). Pure; judged from the WORLD, never
 * from how far the plan got (Codex r2 on the design). The cap cell is open, the open column under it is at least 2 deep,
 * and a body at its bottom can neither walk out (feet and head open beside it) nor step up out (a solid block beside it
 * with two open cells above, and head room above itself).
 */
export function plinthHazard (read, cap) {
  if (typeof read !== 'function' || !cap) return null
  const { x, y: g, z } = cap
  const c = read(x, g, z)
  if (!c) return null
  if (!passable(c)) return false
  let f = g
  for (let y = g - 1; y >= g - 8; y--) {
    const b = read(x, y, z)
    if (!b) return null
    if (!passable(b)) break
    f = y
  }
  if (g - f < 1) return false
  for (const [dx, dz] of CARD) {
    const a = read(x + dx, f, z + dz), h = read(x + dx, f + 1, z + dz), h2 = read(x + dx, f + 2, z + dz), up = read(x, f + 2, z)
    if (!a || !h || !h2 || !up) return null
    if (passable(a) && passable(h)) return false
    if (solid(a) && passable(h) && passable(h2) && passable(up)) return false
  }
  return true
}

// ---- the planner -------------------------------------------------------------------------------------------------------

/** The walk probe's box: home and the cap, 6 around, 10 below and 8 above. Pure. */
export const planBox = (home, cap, pad = 6) => ({
  x0: Math.min(Math.floor(home.x), cap.x) - pad, x1: Math.max(Math.floor(home.x), cap.x) + pad,
  z0: Math.min(Math.floor(home.z), cap.z) - pad, z1: Math.max(Math.floor(home.z), cap.z) + pad,
  y0: Math.min(Math.floor(home.y), cap.y) - 10, y1: Math.max(Math.floor(home.y), cap.y) + 8,
})

// ---- the well's crafting table on a raised well (plinth-02) ------------------------------------------------------------

/** How far the trapdoor craft may be from its table: skills.mjs STATION_REACH (feet to the table's centre), with a margin. */
export const WELL_TABLE_REACH = 4.0
/** ...and the click that puts it down (eye to the floor's top face; the server allows more). */
export const WELL_TABLE_CLICK = 4.5

/**
 * WHERE build_well PUTS ITS CRAFTING TABLE -> {x,y,z} | null. Pure. (plinth-02. FLEET 10-16, plinth-01 on board-c and hive-d:
 * both plinths complete, then 23 of 30 build_well visits failed "nowhere within 2 of the junk well's standing cell to put a
 * crafting table" and no well was ever built. The old rule (composter.mjs tableCellFor) wants a cell AT THE STAND'S LEVEL
 * within 2 of it, Chebyshev >= 2 from the site, on a solid floor. On a raised well the stand is on the 3x3 walls at g, and
 * every such cell is over air -- the plinth's 5x5 is one lower, at g-1.)
 *   1. the old rule, unchanged: a flat well gets exactly the cell it got before;
 *   2. otherwise any cell BELOW the stand's level (1..4 down) with its centre within WELL_TABLE_REACH of the stand's feet and
 *      its floor's top face within WELL_TABLE_CLICK of the eye: off the plinth's 5x5 first (horizontal Chebyshev >= 3 from the
 *      cap), then the plinth's own outer ring at g (Chebyshev 2); never the well column, never a body;
 *   3. a candidate is kept only if the stand is still walkable from the town (`start`) with the table in place (walkReach):
 *      a table must never take the only way up. NO PROOF, NO TABLE (Codex r1 P2): without `start`, or when walkReach cannot
 *      reach the stand today, nothing is offered (null) -- standing on the stand proves this bot arrived, not that the next
 *      one can. A plinth is walkReach-reachable by construction (its planner proves every stand with the same probe).
 *   The floor must be a plain support: never a container (its lid) or town furniture (Codex r1 P3; place() refuses a lid).
 */
export function wellTableCell ({ site, stand, read, bodies = [], start = null, box = null, forbid = () => false, eye = EYE_HEIGHT, report = null } = {}) {
  // `report` (an object, optional) receives `why` when the answer is null: 'no_cell' (nothing placeable in reach), 'no_proof'
  // (no start, or the stand is not walkReach-able from it today), 'route' (every candidate would take the way up) -- Claude P3
  const none = why => { if (report) report.why = why; return null }
  if (!site || !stand || typeof read !== 'function') return none('no_cell')
  const flat = tableCellFor({ site: { x: site.x, y: stand.y, z: site.z }, stand, read, bodies })
  if (flat) return flat
  const out = []
  const fx = stand.x + 0.5, fy = stand.y, fz = stand.z + 0.5
  // dy -3/-4 can never pass the click bound from a stand's eye (Claude P3): kept for a looser bound, harmless
  for (let dy = -1; dy >= -4; dy--) {
    for (let dx = -4; dx <= 4; dx++) {
      for (let dz = -4; dz <= 4; dz++) {
        const x = stand.x + dx, y = stand.y + dy, z = stand.z + dz
        const ring = Math.max(Math.abs(x - site.x), Math.abs(z - site.z))
        if (ring < 2) continue                                                 // the well's 3x3: walls, cap, shaft
        if (inColumn(site, x, y, z) || forbid(x, y, z)) continue
        const cell = read(x, y, z), head = read(x, y + 1, z), floor = read(x, y - 1, z)
        if (!cell || !PLACEABLE_INTO.has(cell.name) || !solid(floor) || isFurniture(floor.name) || !head) continue
        const reach = Math.hypot(x + 0.5 - fx, y + 0.5 - fy, z + 0.5 - fz)
        if (reach > WELL_TABLE_REACH) continue
        if (Math.hypot(x + 0.5 - fx, y - (fy + eye), z + 0.5 - fz) > WELL_TABLE_CLICK) continue
        if ((bodies ?? []).some(b => bodyInCell(b, { x, y, z }))) continue
        out.push({ x, y, z, off: ring >= 3 ? 0 : 1, reach })
      }
    }
  }
  out.sort((a, b) => a.off - b.off || b.y - a.y || a.reach - b.reach || a.x - b.x || a.z - b.z)
  if (!out.length) return none('no_cell')
  const until = cellKey(stand.x, stand.y, stand.z)
  const walkForbid = (x, y, z) => inColumn(site, x, y, z) || forbid(x, y, z)
  if (!start || !walkReach(read, start, { box, forbid: walkForbid, until }).has(until)) return none('no_proof')
  for (const c of out.slice(0, 8)) {
    const withTable = overlay(read, new Map([[cellKey(c.x, c.y, c.z), PLACED]]))
    if (!walkReach(withTable, start, { box, forbid: walkForbid, until }).has(until)) continue
    return { x: c.x, y: c.y, z: c.z }
  }
  return none('route')
}

/**
 * ONE CANDIDATE, CHEAPLY -> { cap, t, k, fills, leaves, opens, cost } | { why }. Pure. The cell classes, the keep-outs and
 * the ORACLE on the world with the fills and leaf clears applied (no sequencing yet).
 *   keepOut  [{ x, y, z, r }]: no planned cell within Chebyshev r (3D) -- the old well's cells, the town's records
 */
export function plinthCandidate (read, { home, avoid = [], keepOut = [], x, z, t, k, clearLeaves = true }) {
  const g = t + k, cap = { x, y: g, z }
  if (townDistance(home, { x, y: g + 1, z }) > ADOPT_RADIUS) return { why: 'envelope' }
  if (Math.hypot(x - home.x, z - home.z) < WELL_HOME_CLEARANCE) return { why: 'home' }
  const fills = [], leaves = [], opens = []
  for (const c of plinthShell(cap)) {
    const cls = shellClass(read(c.x, c.y, c.z), { clearLeaves })
    if (cls === 'unknown') return { why: 'unknown' }
    if (cls === 'refuse') return { why: 'solid', name: read(c.x, c.y, c.z)?.name }
    if (cls === 'fill') fills.push(c)
    if (cls === 'leaf') { leaves.push(c); fills.push(c) }
  }
  for (const c of plinthColumn(cap)) {
    const b = read(c.x, c.y, c.z)
    if (!b) return { why: 'unknown' }
    if (passable(b)) continue
    if (clearLeaves && LEAVES.test(b.name ?? '')) { opens.push(c); leaves.push(c); continue }
    // natural ground the build digs (fresh/half_dug at k = 0..1); anything else (a cover from an old pit, a log) refuses
    if (!(ground(b) && Number.isFinite(b.hardness) && b.hardness >= 0 && b.hardness <= 2)) return { why: 'column', name: b.name }
  }
  for (const c of plinthAbove(cap)) {
    const b = read(c.x, c.y, c.z)
    if (!b) return { why: 'unknown' }
    if (passable(b)) continue
    if (clearLeaves && LEAVES.test(b.name ?? '')) { opens.push(c); leaves.push(c); continue }
    return { why: 'open', name: b.name }
  }
  // OPEN FROM ABOVE (the prototype's rule 4): every cell over a fill, up to g+2, is open or a later fill/clear. A sealed
  // void under natural ground could only be reached by a hidden side click; it is refused here, cheaply, before sequencing.
  const later = new Set([...fills, ...opens].map(c => K(c.x, c.y, c.z)))
  for (const c of fills) {
    for (let y = c.y + 1; y <= g + 2; y++) {
      if (later.has(K(c.x, y, c.z))) continue
      const b = read(c.x, y, c.z)
      if (!b) return { why: 'unknown' }
      if (passable(b)) continue
      // leaves over a fill (the canopy) are cleared like the shell's own: the approved leaf clear, nothing else is dug
      if (clearLeaves && LEAVES.test(b.name ?? '')) { const o = { x: c.x, y, z: c.z }; opens.push(o); leaves.push(o); later.add(K(c.x, y, c.z)); continue }
      return { why: 'enclosed' }
    }
  }
  // KEEP-OUTS: no planned cell beside town furniture, or within a record's keep-out
  const planned = [...fills, ...opens]
  for (const c of planned) {
    for (const o of keepOut) if (Math.max(Math.abs(c.x - o.x), Math.abs(c.y - o.y), Math.abs(c.z - o.z)) <= (o.r ?? 1)) return { why: 'keepout' }
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const b = read(c.x + dx, c.y + dy, c.z + dz)
      if (b && isFurniture(b.name)) return { why: 'furniture', name: b.name }
    }
  }
  const cells = new Map()
  for (const c of fills) cells.set(K(c.x, c.y, c.z), PLACED)
  for (const c of opens) cells.set(K(c.x, c.y, c.z), AIR)
  const why = wellSiteRefusal(overlay(read, cells), cap, home, { avoid })
  if (why) return { why: `oracle:${why}` }
  // a clear is cheaper than a placement (no block spent, no tool), but it is still a dig: half weight
  return { cap, t, k, fills, leaves, opens, cost: fills.length + 0.5 * opens.length }
}

/**
 * EVERY FEASIBLE CANDIDATE, cheapest first -> { cands, tally }. Pure. The well search's own spiral (WELL_HOME_CLEARANCE ..
 * WELL_SEARCH_RADIUS around home), each column at k = 0..PLINTH_MAX_RAISE; the cheapest k of a column first, ties in spiral
 * order. `tally` counts the first refusal of each column's cheapest-to-refuse k (for the no-plan row).
 */
export function plinthCandidates ({ read, home, avoid = [], keepOut = [], clearLeaves = true, minK = 0, bare = true } = {}) {
  const hy = Math.floor(home.y ?? 64)
  const cands = [], tally = { cols: 0 }
  let i = 0
  for (const { x, z } of wellSpiral(home)) {
    tally.cols++
    const t = columnSurface(read, x, z, hy, { throughLeaves: clearLeaves })
    if (t === null) { tally.unknown = (tally.unknown ?? 0) + 1; continue }
    if (t === undefined) { tally.nocap = (tally.nocap ?? 0) + 1; continue }
    let any = false, first = null
    for (let k = Math.max(0, Math.min(PLINTH_MAX_RAISE, Number(minK) || 0)); k <= PLINTH_MAX_RAISE; k++) {
      const c = plinthCandidate(read, { home, avoid, keepOut, x, z, t, k, clearLeaves })
      // `bare` false (plinth-first): never a candidate with nothing PLACED -- the natural cell, or the natural cell with only a
      // leaf cleared (Claude r4 P2-1; Codex r5 P2: a leaf clear costs 0.5, so `cost > 0` admitted it)
      if (c.cap && (bare || c.fills.length > 0)) { cands.push({ ...c, order: i }); any = true } else if (!first) first = c.cap ? 'bare' : c.why
    }
    if (!any) { const w = String(first).replace(/:.*/, ''); tally[w] = (tally[w] ?? 0) + 1 }
    i++
  }
  cands.sort((a, b) => a.cost - b.cost || a.order - b.order || a.k - b.k)
  return { cands, tally }
}

/**
 * THE STAIR OPTIONS for a cap -> [[cells]]: from the ledge (feet g at Chebyshev 2) outward along a cardinal, one-wide, at
 * lateral offsets 0, -1, +1; step j (Chebyshev 2+j) has its top block at g-1-j, filled from the ground up; it ends where
 * the ground meets it (feet within one step). An option whose cells are not all replaceable, or that would need more
 * than PLINTH_MAX_RAISE steps, is dropped. The empty stair comes first. Pure.
 */
export function stairOptions (read, cap, { keepOut = [] } = {}) {
  const out = [[]]
  const { x, y: g, z } = cap
  for (const [dx, dz] of CARD) {
    for (const lat of [0, -1, 1]) {
      const lx = dz ? lat : 0, lz = dx ? lat : 0
      const cells = []
      let ok = true, ended = false
      for (let j = 1; j <= PLINTH_MAX_RAISE && ok && !ended; j++) {
        const cx = x + dx * (2 + j) + lx, cz = z + dz * (2 + j) + lz
        const top = g - 1 - j
        // the ground in this column: the highest solid at or below top+1
        let s = null
        for (let y = top + 1; y >= top - 8; y--) { const b = read(cx, y, cz); if (!b) { ok = false; break } if (solid(b)) { s = y; break } }
        if (!ok || s === null) { ok = false; break }
        if (s >= top) { ended = true; break }               // the ground is as high as the step: walk on
        for (let y = s + 1; y <= top; y++) {
          const b = read(cx, y, cz)
          if (!replaceable(b)) { ok = false; break }
          cells.push({ x: cx, y, z: cz, role: 'stair' })
        }
        if (!ok) break
        for (let y = top + 1; y <= top + 3; y++) { if (!passable(read(cx, y, cz))) { ok = false; break } }   // feet, head, jump
        if (s + 1 >= top) ended = true                       // one step up from the ground: done
      }
      if (!ok || !cells.length) continue
      if (cells.some(c => keepOut.some(o => Math.max(Math.abs(c.x - o.x), Math.abs(c.y - o.y), Math.abs(c.z - o.z)) <= (o.r ?? 1)))) continue
      // THE SHELL'S FURNITURE CLEARANCE, for the stair too (lidclear-01 rebase review, Claude + Codex 10-16): a chest counts
      // as solid ground above, so without this a stair could be filled on a town chest's LID -- which no bot may then dig
      // (it is a well cell) and the town's count would stay unknown for good
      if (cells.some(c => furnitureNear(read, c.x, c.y, c.z))) continue
      out.push(cells)
    }
  }
  return out.sort((a, b) => a.length - b.length)
}

/** The stands of the FINISHED well (wellStand's four cardinal cells, feet g+1) a body can use. */
const finalStands = (read, cap) => CARD.map(([dx, dz]) => ({ x: cap.x + dx, y: cap.y + 1, z: cap.z + dz })).filter(s => standable(read, s.x, s.y, s.z))

/**
 * SEQUENCE ONE CANDIDATE -> { plan } | { why }. Pure. Orders the leaf clears and placements (lowest first, a clear before
 * the fill of its cell), gives each a support face and a stand in the world as it is at that step, re-walks the town
 * after each step (the stand must still reach it), finds the step that makes the column a hazard and proves a cover can be
 * placed in every hazardous state, and probes a walk from the town to a throwing stand at the end (with the cheapest
 * stair that makes it walkable).
 */
export function sequencePlinth (read, cand, opts = {}) {
  const it = sequencePlinthSteps(read, cand, opts)
  for (;;) { const r = it.next(); if (r.done) return r.value }
}
/** sequencePlinth as a generator: it yields after every step it orders (the planner's long part), so the bot's event loop
 *  runs between them; the return value is sequencePlinth's. Pure. */
export function * sequencePlinthSteps (read, cand, { home, start = null, clearLeaves = true, keepOut = [], otherColumns = [] } = {}) {
  const { cap } = cand
  const st = start ?? startNear(read, home)
  if (!st) return { why: 'no_start' }
  const box = planBox(home, cap)
  // THE OTHER COLUMNS this town has started (a voided or replaced plinth: still priced out of every path) are no stand
  // and no route for this plan either (Claude r1 P3-4)
  const others = (Array.isArray(otherColumns) ? otherColumns : []).filter(o => o && !(o.x === cap.x && o.y === cap.y && o.z === cap.z))
  const forbid = (x, y, z) => inColumn(cap, x, y, z) || others.some(o => inColumn(o, x, y, z))
  let lastWhy = 'no_stair', lastStuck = null, lastSteps = null
  for (const stair of stairOptions(read, cap, { keepOut }).filter(st => !st.some(c => others.some(o => inColumn(o, c.x, c.y, c.z))))) {
    // the finished world must be walkable to a throwing stand before any sequencing is worth doing
    const fin = new Map()
    for (const c of cand.fills) fin.set(K(c.x, c.y, c.z), PLACED)
    for (const c of cand.opens) fin.set(K(c.x, c.y, c.z), AIR)
    for (const c of stair) fin.set(K(c.x, c.y, c.z), PLACED)
    const finRead = overlay(read, fin)
    const finReach = walkReach(finRead, st, { box, forbid })
    const stands = finalStands(finRead, cap).filter(s => finReach.has(K(s.x, s.y, s.z)))
    if (!stands.length) { lastWhy = 'no_route'; continue }
    if (!wellStand(finRead, cap)) { lastWhy = 'no_stand'; continue }
    const r = yield * orderSteps(read, cand, stair, { st, box, forbid })
    if (r.why) { lastWhy = r.why; lastStuck = r.stuck; lastSteps = r.steps; continue }
    const ws = wellStand(finRead, cap)
    const steps = r.steps
    return { plan: {
      v: PLINTH_VERSION, cap: { ...cap }, t: cand.t, k: cand.k, facing: ws.facing, start: { ...st },
      steps, cost: steps.filter(s => s.op === 'place').length, clears: steps.filter(s => s.op === 'clear').length,
      stair: stair.map(c => [c.x, c.y, c.z]), hazardStep: r.hazardStep, box: { ...box },
      capWas: plinthColumn(cap).map(c => (passable(read(c.x, c.y, c.z)) ? 'open' : 'ground')),
    } }
  }
  return { why: lastWhy, stuck: lastStuck, steps: lastSteps }
}

function * orderSteps (read0, cand, stair, { st, box, forbid }) {
  const { cap } = cand
  const cells = new Map()
  const world = overlay(read0, cells)
  const leafSet = new Set(cand.leaves.map(c => K(c.x, c.y, c.z)))
  const stairKeys = new Set(stair.map(c => K(c.x, c.y, c.z)))
  const todo = []
  for (const c of cand.leaves) todo.push({ op: 'clear', c })
  for (const c of [...cand.fills, ...stair]) todo.push({ op: 'place', c })
  // LEAVES ARE CLEARED FROM THE TOP DOWN (open from above, so every leaf is seen and every pocket is climbed out of), first;
  // BLOCKS ARE PLACED FROM THE BOTTOM UP (each on what is below it). The first feasible action in this order is taken.
  todo.sort((a, b) => (a.op === b.op ? 0 : a.op === 'clear' ? -1 : 1) || (a.op === 'clear' ? b.c.y - a.c.y : a.c.y - b.c.y) || (K(a.c.x, a.c.y, a.c.z) - K(b.c.x, b.c.y, b.c.z)))
  const steps = []
  let reach = walkReach(world, st, { box, forbid })
  let prev = st, hazardStep = null
  const avoidStand = (x, y, z) => forbid(x, y, z)
  while (todo.length) {
    yield steps.length
    let done = false
    for (let i = 0; i < todo.length && !done; i++) {
      const a = todo[i], c = a.c, key = K(c.x, c.y, c.z)
      if (a.op === 'place' && leafSet.has(key) && todo.some(o => o.op === 'clear' && K(o.c.x, o.c.y, o.c.z) === key)) continue
      // BOTTOM-UP IN EVERY COLUMN: never place over a cell of the plan still to be done below it (it would seal it from above)
      if (a.op === 'place' && todo.some(o => o !== a && o.c.x === c.x && o.c.z === c.z && o.c.y < c.y)) continue
      const options = []
      if (a.op === 'clear') {
        options.push({ point: { x: c.x + 0.5, y: c.y + 0.5, z: c.z + 0.5 }, topFace: false, ref: null, face: null })
      } else {
        if (!replaceable(world(c.x, c.y, c.z))) continue
        for (const s of supportsFor(world, c)) options.push({ point: faceCentre(s.ref, s.face), topFace: s.face[1] === 1, ref: s.ref, face: s.face })
      }
      if (!options.length) continue
      // CHEAP FIRST: no stand even before the after-click proof -> no search of the world after it
      if (!options.some(o => standFor(world, { target: c, point: o.point, topFace: o.topFace, reach, avoid: avoidStand }))) continue
      // THE WORLD AFTER THIS CLICK, once per action: who the town reaches, and who walks BACK to the town (Codex r2 P1-1:
      // the town reaching a stand is not the stand reaching the town -- a drop of 3 is a move, a climb of 2 is not)
      cells.set(key, a.op === 'clear' ? AIR : PLACED)
      const back = walkReachBack(world, st, { box, forbid })
      cells.delete(key)
      let next = null                                                 // the town's reach after the click: only once a stand is found
      const usable = { has: k => reach.has(k) && back.has(k) }       // reachable before the click, walks out after it
      for (const o of options) {
        const stand = standFor(world, { target: c, point: o.point, topFace: o.topFace, reach: usable, avoid: avoidStand, prefer: prev })
        if (!stand) continue
        cells.set(key, a.op === 'clear' ? AIR : PLACED)
        next ??= walkReach(world, st, { box, forbid })
        // the hazard: the first step that makes it; every hazardous state must be coverable from a reachable stand
        const hz = plinthHazard(world, cap)
        if (hz) {
          const cr = coverRef(world, cap, null)
          const cs = cr && coverableAfter(world, cap, { start: st, box, forbid })   // both directions (Claude r3 P3-3)
          if (!cs) { cells.delete(key); continue }
          if (hazardStep === null) hazardStep = steps.length
        }
        if (a.op === 'clear' && stand.x === c.x && stand.z === c.z && stand.y - 1 === c.y) { cells.delete(key); continue }   // never dig its own floor
        steps.push({ op: a.op, c: [c.x, c.y, c.z], ...(o.ref ? { r: [o.ref.x, o.ref.y, o.ref.z], f: o.face } : {}), s: [stand.x, stand.y, stand.z],
                     ...(stairKeys.has(key) ? { stair: 1 } : {}) })
        todo.splice(i, 1)
        reach = next
        prev = stand
        done = true
        break
      }
    }
    if (!done) return { why: 'no_stand_or_support', left: todo.length, stuck: todo.slice(0, 6).map(a => `${a.op}:${a.c.x},${a.c.y},${a.c.z}`), steps }
  }
  return { steps, hazardStep }
}

/**
 * THE TOWN'S RAISED-WELL PLAN -> { plan, why, tally, tried }. Pure. Candidates cheapest first (plinthCandidates), each
 * sequenced (sequencePlinth) until one passes, at most PLINTH_MAX_TRIES. `why` names the last refusal when none does.
 */
export function planPlinth (opts = {}) {
  const it = planPlinthSteps(opts)
  for (;;) { const r = it.next(); if (r.done) return r.value }
}
/** planPlinth as a generator: it yields after each candidate it sequences, so a bot can let its event loop run between
 *  them (skills.mjs buildPlinth); the return value is planPlinth's. Pure. */
export function * planPlinthSteps ({ read, home, avoid = [], keepOut = [], clearLeaves = true, start = null, maxTries = PLINTH_MAX_TRIES, otherColumns = [], minK = 0, bare = true } = {}) {
  if (typeof read !== 'function' || !home) return { plan: null, why: 'no_home', tally: null, tried: 0 }
  const r = memoRead(read, home)
  const { cands, tally } = plinthCandidates({ read: r, home, avoid, keepOut, clearLeaves, minK, bare })
  if (tally.unknown) return { plan: null, why: 'unknown', tally, tried: 0 }
  let tried = 0, why = cands.length ? null : 'no_candidate', best = null, found = 0
  for (const c of cands) {
    if (tried >= maxTries || found >= PLINTH_MAX_FOUND) break
    // a candidate's cheap cost is a lower bound of its total (the stair only adds): none further can beat the best
    if (best && c.cost >= plinthTotal(best)) break
    tried++
    const s = yield * sequencePlinthSteps(r, c, { home, start, clearLeaves, keepOut, otherColumns })
    yield tried
    if (s.plan) { found++; if (!best || plinthTotal(s.plan) < plinthTotal(best)) best = s.plan; continue }
    tally[`seq_${s.why}`] = (tally[`seq_${s.why}`] ?? 0) + 1
    why = s.why
  }
  if (best) return { plan: best, why: null, tally, tried }
  return { plan: null, why: why ?? 'no_candidate', tally, tried }
}

// ---- progress, from the world ------------------------------------------------------------------------------------------

/**
 * HOW FAR ALONG IS THE PLAN, READ FROM THE WORLD -> { done, total, next, placesLeft, blocked, unknown, complete, covered }.
 * Pure; every visit re-derives its work from here, never from a counter. A place step is done when its cell is ground
 * (any ground: a bot may have placed a different stone); a clear step when its cell is no longer leaves. `blocked` names
 * a step whose cell holds something the plan cannot place into (a chest, a sapling, a liquid): the plan is void.
 * `covered`: the cap cell holds a block where the plan left it open (a pit cover, to be dug out on resume).
 */
export function plinthProgress (read, plan) {
  const out = { done: 0, total: 0, next: null, placesLeft: 0, blocked: null, unknown: false, complete: false, covered: false }
  if (typeof read !== 'function' || !plan?.steps) return { ...out, blocked: 'no plan' }
  out.total = plan.steps.length
  const cleared = new Set()
  for (let i = 0; i < plan.steps.length; i++) {
    const s = plan.steps[i], [x, y, z] = s.c, b = read(x, y, z)
    if (!b) { out.unknown = true; if (out.next === null) out.next = i; continue }
    let ok
    if (s.op === 'clear') {
      ok = !LEAVES.test(b.name ?? '')
      if (ok) cleared.add(K(x, y, z))
      else if (out.next === null) out.next = i
    } else {
      ok = ground(b)
      if (!ok) {
        out.placesLeft++
        if (out.next === null) out.next = i
        if (!replaceable(b) && !LEAVES.test(b.name ?? '')) out.blocked ??= `${b.name} at ${x},${y},${z}`
      }
    }
    if (ok) out.done++
  }
  const c = plan.cap, capCell = read(c.x, c.y, c.z)
  if (!capCell) out.unknown = true
  else if (plan.capWas?.[0] === 'open' && !passable(capCell)) {
    // ONLY A PIT COVER IS A COVER (Codex r4 N5): any other block in the cap cell is a foreign block -- never dug, the plan voids
    if (isPitCover(capCell)) out.covered = true
    else out.blocked ??= `${capCell.name} at ${c.x},${c.y},${c.z}`
  }
  out.complete = out.done === out.total && !out.unknown
  return out
}

// ---- funding ----------------------------------------------------------------------------------------------------------

/**
 * THE BLOCK TO PLACE NEXT from this bag -> name | null. Pure. PLINTH_BLOCKS in order (the well's decorations first), and
 * only while the bag keeps STONE_GUARD of RESERVE_STONE AND still holds a pit cover (well.mjs pitCoverItem) after it: the
 * exit contract's reserve and the builder's own cover are never spent on the plinth.
 */
export function plinthBlockFor (items = []) {
  const list = (Array.isArray(items) ? items : []).filter(it => it?.name && (Number(it.count) || 0) > 0)
  for (const name of PLINTH_BLOCKS) {
    const it = list.find(x => x.name === name)
    if (!it) continue
    const after = list.map(x => (x === it ? { ...x, count: x.count - 1 } : x)).filter(x => x.count > 0)
    if (reserveStone(after) >= STONE_GUARD && pitCoverItem(after)) return name
  }
  return null
}
/** How many plinth blocks this bag can spend, keeping the reserve and a cover -> n >= 0. Pure (counted by simulation). */
export function plinthBudget (items = [], cap = 999) {
  let list = (Array.isArray(items) ? items : []).filter(it => it?.name && (Number(it.count) || 0) > 0).map(it => ({ name: it.name, count: Number(it.count) }))
  let n = 0
  while (n < cap) {
    const name = plinthBlockFor(list)
    if (!name) break
    let done = false
    list = list.map(x => { if (!done && x.name === name) { done = true; return { ...x, count: x.count - 1 } } return x }).filter(x => x.count > 0)
    n++
  }
  return n
}
/** How many RESERVE_STONE blocks a withdraw should bring so the bag can spend `need` -> n >= 0. Pure. */
export function plinthShortfall (items = [], need = 0) {
  const have = plinthBudget(items, need)
  if (have >= need) return 0
  // every block withdrawn above the reserve is spendable, as long as a cover is held (pitCoverItem prefers dirt; else
  // one more cobble beyond the guard)
  const stone = reserveStone(items)
  const guardGap = Math.max(0, STONE_GUARD - stone)
  const coverGap = pitCoverItem(items) ? 0 : 1
  return guardGap + coverGap + (need - have)
}

// ---- the town record, the lease and the order --------------------------------------------------------------------------

/**
 * IS THIS RECORD A USABLE PLAN FOR THIS WORLD? -> 'plan' | 'complete' | 'none' | 'void' | null. Pure. A record from another
 * world (a reseed) is null; one with a different PLINTH_VERSION is null (replanned).
 */
export function plinthRecordState (rec, world = null) {
  if (!rec || typeof rec !== 'object' || rec.v !== PLINTH_VERSION || !sameWorld(rec.world ?? null, world)) return null
  if (rec.state === 'none') return 'none'
  if (rec.state === 'void') return 'void'
  if (!rec.plan?.cap || !Array.isArray(rec.plan.steps)) return null
  return rec.state === 'complete' ? 'complete' : 'plan'
}

/**
 * WHO HOLDS THE TOWN'S BUILD -> { free, mine, holder, leftMs }. Pure. An expired lease is free; a lease from the future
 * too. `me` is the holder's TOKEN (one per acquisition, Codex r1 P1-2): the same username on a new connection is not the
 * holder, and waits out the old one's lease like anyone else. A lease without a token compares its `by`.
 */
export function leaseState (lease, now = 0, me = null) {
  const until = Number(lease?.until), at = Number(lease?.at)
  if (!lease || !Number.isFinite(until) || until <= now || (Number.isFinite(at) && at > now + 60_000)) return { free: true, mine: false, holder: null, leftMs: 0 }
  if (me != null && (lease.token ?? lease.by) === me) return { free: true, mine: true, holder: lease.by ?? null, leftMs: until - now }
  return { free: false, mine: false, holder: lease.by ?? '?', leftMs: until - now }
}

/**
 * DOES THE TOWN WANT A PLINTH VISIT? -> { want: 'plan' | 'build' | null, why }. Pure.
 *   wellUsable  a sealed town well stands (nothing to do)
 *   rec         the plinth record (plinthRecordState)
 *   noSite      the town's no-site record (wellsite-01): its existence for this world is what starts a plan
 * A plan record wants building until complete. A 'none' or 'void' record is replanned once it ages out / at once.
 * A complete plinth whose well is gone (a later no-site record) is planned again.
 */
export function plinthWant ({ wellUsable = false, rec = null, noSite = null, world = null, now = 0, shared = true, first = false, naturalPit = false, loaded = true } = {}) {
  // ONE BUILDER NEEDS ONE RECORD (plinthfirst-01, Codex + Claude r1 P1): the lease, the plan and every path's exclusions live in
  // the bot's pool state dir; in an isolated memory scope that dir is the bot's own while five bots share one town
  if (!shared) return { want: null, why: 'unshared' }
  if (wellUsable) return { want: null, why: 'well' }
  const state = plinthRecordState(rec, world)
  const noSiteHere = !!noSite && Number.isFinite(Number(noSite.at)) && sameWorld(noSite.world ?? null, world)
  // PLINTH-FIRST: no usable well is itself the trigger (no natural search runs, so nothing else would say so) -- unless a
  // natural pit build_well is finishing (plinthFirstRefusal lets it) stands recorded: never two wells at once; and only when
  // `loaded` (areaLoaded): a well in a chunk this bot has not been sent is invisible, and "no well seen" is then no evidence.
  // Both are read lazily, once, and only by the branches that need them (Claude r2 P3-2)
  let pit
  const pitNow = () => (pit ??= !!lz(naturalPit))
  const firstHere = () => first && !pitNow() && lz(loaded) === true
  // `left`: the places the last visit left (0: only the hand-off is owed, which needs no blocks)
  if (state === 'plan') return { want: 'build', why: 'plan', left: Number.isFinite(Number(rec.left)) ? Number(rec.left) : null }
  if (state === 'none') {
    const age = now - Number(rec.at)
    if (Number.isFinite(age) && age >= 0 && age < PLINTH_NONE_BACKOFF_MS) return { want: null, why: 'none_held' }
    // NOT plinth-first's trigger (Claude r1 P2-1): a planner that found nothing hands the town back to the natural search
    // (plinthFirstOn is off while the record is 'none'); only that search's own exhaustion -- a no-site record -- replans
    // ...and a no-site record NEWER than the none (Claude r2 P3-1: the one that started the failed plan must not replan beside
    // a natural pit the restored search has started since)
    const fresh = noSiteHere && Number(noSite.at) > Number(rec.at)
    // ...or, once plinth-first is in force again (PLINTH_FIRST_NONE_WINDOW_MS after the none), its own trigger
    return fresh || rec.trigger === 'void' || firstHere() ? { want: 'plan', why: 'none_aged' } : { want: null, why: 'no_trigger' }
  }
  if (state === 'complete') {
    if (noSiteHere && Number(noSite.at) > Number(rec.doneAt ?? rec.at)) {
      const lost = completeLost({ noSite, rec })
      return lost.lost ? { want: 'plan', why: 'complete_lost', evidence: lost.why } : { want: null, why: lost.why }
    }
    return { want: null, why: 'complete' }
  }
  // A VOIDED STRUCTURE IS ITS OWN TRIGGER (Codex r2 P2-6: a partial hand-off may already have lifted the no-site hold)
  if (state === 'void') return { want: 'plan', why: 'void' }
  if (noSiteHere && !(first && pitNow())) return { want: 'plan', why: 'no_site' }
  if (firstHere()) return { want: 'plan', why: 'plinth_first' }
  return { want: null, why: !first ? 'no_trigger' : pitNow() ? 'natural_pit' : 'unloaded' }
}
const lz = v => (typeof v === 'function' ? v() : v)

/**
 * IS A FINISHED RAISED WELL LOST? (plinthfirst-01; Codex r1 P2-3 / Claude r1 P1-1, plinth-02's own defect) -> { lost, why }.
 * Pure. plinth-02 replanned on ANY no-site record newer than the hand-off. Such a record also followed a TRANSIENT refusal of
 * the cap (measured: board-c's finished cap was refused by build_well on 10-16 at 16:58Z and 21:19Z, and its well was built on
 * it at 06:53Z the next day), which would have started a second plinth beside a good one. Now build_well writes the no-site
 * record over a finished cap only with EVIDENCE about that cap (`lost`: { cap, cls, why }): 'structural' (plinthCapLoss) at
 * once, 'persisted' once a transient refusal has lasted PLINTH_LOST_PATIENCE_MS (capRefusalNext). A record that names no
 * cap -- another build wrote it -- keeps plinth-02's rule (lost).
 */
export const PLINTH_LOST_PATIENCE_MS = 6 * 60 * 60 * 1000
/** ...and seen at least this many times (by any bot of the town) in that span: one refusal long ago is not a persisting one. */
export const PLINTH_LOST_MIN_SEEN = 3
export function completeLost ({ noSite = null, rec = null } = {}) {
  const L = noSite?.lost, cap = rec?.plan?.cap
  if (!L || !cap || !L.cap || L.cap.x !== cap.x || L.cap.y !== cap.y || L.cap.z !== cap.z) return { lost: true, why: 'no_evidence' }
  if (L.cls === 'structural' || L.cls === 'persisted') return { lost: true, why: L.cls }
  return { lost: false, why: 'complete_held' }
}
/**
 * WHAT IS WRONG WITH A FINISHED PLINTH'S CAP? -> 'structural' | 'transient'. Pure; asked of a cap build_well's site rule
 * just refused (wellSiteRefusal said something other than 'unknown'). Structural: the column is not a column any more, a
 * built well there is no longer sealed (wellSiteRefusal says 'already a well' before it checks anything), the shaft is no
 * longer sealed (containmentRefusal) or its floor is gone. Anything else -- a stand, a chest or door nearby,
 * something standing above the cap, an unreadable cell -- is transient: never by itself evidence that the shell is lost.
 */
export function plinthCapLoss (read, cap) {
  if (typeof read !== 'function' || !cap) return 'transient'
  const stage = pfWellStage(read, cap)
  if (stage === 'invalid') {
    const c = read(cap.x, cap.y, cap.z), s = read(cap.x, cap.y - 1, cap.z)
    return c && s ? 'structural' : 'transient'
  }
  if (stage === 'built') {
    // ONLY THE SEAL (Claude r2 P2-1): wellBreach's other verdict, "every throwing stand is blocked", is a removable block --
    // transient, like the chest beside it
    const c = pfContainment(read, cap)
    return c && c !== 'unknown' ? 'structural' : 'transient'
  }
  const c = pfContainment(read, cap)
  if (c && c !== 'unknown') return 'structural'
  const f = read(cap.x, cap.y - 2, cap.z)
  return f && !wellGround(f) ? 'structural' : 'transient'
}
/** A structural verdict is believed only when seen again this long after the first (Claude r2 P2-1: one bot's view can hold
 *  a ghost cell -- client air over server stone -- and a breached well is never thrown into meanwhile). */
export const PLINTH_STRUCT_CONFIRM_MS = 10 * 60 * 1000
/**
 * A FINISHED CAP WAS REFUSED -> { verdict: 'lost' | 'hold', cls, note }. Pure. `prev` is the town's note for this cap
 * ({ transient: { since, at, n }, structural: { since, at, n }, why }), which only an AFFIRMATIVE recovery clears (the cap
 * passing the site rule, or its well read sealed -- never an unsure reading: skills.mjs; Codex r2 P2-2, r3 P2-1).
 *   structural  lost once seen twice, PLINTH_STRUCT_CONFIRM_MS apart (Claude r2 P2-1); held until then
 *   transient   HELD (this bot backs off; no town hold, no replan); lost ('persisted') once first seen PLINTH_LOST_PATIENCE_MS
 *               ago and seen PLINTH_LOST_MIN_SEEN times with no recovery between -- however sparse the visits (Codex r2 P2-1)
 *               -- so a cap a chest or a blocked stand keeps refused for good is replaced, never a dead end.
 */
export function capRefusalNext ({ prev = null, cls = 'transient', why = '', now = 0 } = {}) {
  const w = String(why ?? '').slice(0, 80)
  // ONE EPISODE PER CLASS (Claude r3 P3-1): a ghost wall seen by one bot must not restart the chest's 6 h, nor the reverse
  const sub = c => {
    const p = prev?.[c], ps = Number(p?.since), pa = Number(p?.at)
    return Number.isFinite(ps) && Number.isFinite(pa) && ps <= now && pa <= now && ps <= pa ? { since: ps, at: pa, n: Math.max(1, Number(p?.n) || 1) } : null
  }
  const keep = { transient: sub('transient'), structural: sub('structural') }
  const was = keep[cls]
  const cur = { since: was ? was.since : now, at: now, n: (was ? was.n : 0) + 1 }
  const note = { ...keep, [cls]: cur, why: w }
  if (!note.transient) delete note.transient
  if (!note.structural) delete note.structural
  if (cls === 'structural') return cur.n >= 2 && now - cur.since >= PLINTH_STRUCT_CONFIRM_MS ? { verdict: 'lost', cls: 'structural', note } : { verdict: 'hold', cls: 'structural', note }
  return now - cur.since >= PLINTH_LOST_PATIENCE_MS && cur.n >= PLINTH_LOST_MIN_SEEN ? { verdict: 'lost', cls: 'persisted', note } : { verdict: 'hold', cls: 'transient', note }
}
/**
 * ARE THIS TOWN'S RECORDS ONE TOWN'S? -> true | false. Pure (Codex + Claude r1 P1, plinth-02's own hazard). The lease, the
 * plan and every path's plinth exclusions live in poolStateDir(MEMORY_POOL). In an ISOLATED memory scope -- and wherever the
 * pool is named for this one bot -- that dir is the bot's own while its peers share the world and the home (10-17:
 * isolated-a..d, five bots per server, MEMORY_POOL=self-isolated-<pool>-<Bot>), so a plinth there would have five builders.
 */
export function townRecordsShared ({ scope = null, pool = '', name = '' } = {}) {
  if (scope === 'isolated') return false
  const p = String(pool ?? ''), n = String(name ?? '')
  return !(n && p.includes(n))
}

/** The plinth order's vertical bound around home (towndeposit.mjs TOWN_V, the town zone's; a test asserts they agree). */
export const PLINTH_ORDER_DY = 12
/**
 * THE PLINTH ORDER -> { order, state }. Pure; cognitive.mjs supplies the readings and keeps `state`. Ahead of the town
 * deposit (design 3.4: at a full bag the plinth takes a funded bot's surplus before any banking), on its own cooldown.
 *   distHome, dy, inside   at town (|dy| <= PLINTH_ORDER_DY of home), not inside a well
 *   want    () -> plinthWant
 *   lease   () -> leaseState
 *   budget  blocks this bag can spend (plinthBudget); chests  a town container is in sight; freeSlots
 * Funded: budget >= PLINTH_MIN_FUND, or a free slot and a town chest to withdraw from. A planning visit needs no funds.
 */
export function plinthOrder ({ now = 0, distHome = Infinity, dy = 0, inside = false, want = null, lease = null, budget = 0, freeSlots = 0,
                               chests = false, chestSlots = 1, state = {} } = {}) {
  const s = { ...state }
  const none = () => ({ order: null, state: s })
  if (!(distHome <= TOWN_RADIUS)) return none()
  // NOT FROM A MINE BELOW THE TOWN (Claude r1 P2-2): the build walks on foot (no digging, no towers), so a bot 12+ below home
  // cannot reach a stand, and three such 'unreachable' visits voided a good plan. The town deposit's own vertical bound.
  if (!(Math.abs(Number(dy)) <= PLINTH_ORDER_DY)) return none()
  if (now - (s.lastAt ?? -Infinity) < PLINTH_COOLDOWN_MS || now < (s.backoffUntil ?? 0)) return none()
  if (now - (s.lastScanAt ?? -Infinity) < WELL_SCAN_MS) return none()
  s.lastScanAt = now
  const lz = v => (typeof v === 'function' ? v() : v)
  if (lz(inside)) return none()
  const w = lz(want)
  if (!w?.want) return none()
  const l = lz(lease)
  if (l && !l.free) return none()
  const b = Number(lz(budget)) || 0
  // THE CHEST ROUTE needs room for what would make the bag spendable (Claude r1 P3-5: one slot only topped up the reserve)
  const funded = b >= PLINTH_MIN_FUND || (freeSlots >= Math.max(1, Number(lz(chestSlots)) || 1) && !!lz(chests))
  if (w.want === 'build' && !funded && w.left !== 0) return none()
  s.lastAt = now
  return { order: { skill: 'build_plinth', args: {}, why: w.want === 'plan' ? 'no junk well site in town: plan a raised well' : `the town's raised junk well is unfinished; ${b} block(s) to spend${b < PLINTH_MIN_FUND ? ' (more from a town chest)' : ''}` }, state: s }
}

/** After a build_plinth ran -> the new state. A skip or an abort costs nothing; no plan holds 2 h; a fault backs off. */
export function plinthOrderOutcome (status, now = 0, state = {}, failClass = null) {
  const s = { ...state }
  if (status === 'success') { s.backoffUntil = 0; return s }
  if (status === 'no_effect' && failClass === 'plinth_none') { s.backoffUntil = Math.max(s.backoffUntil ?? 0, now + PLINTH_NONE_BACKOFF_MS); return s }
  if (status !== 'failed') return s
  s.backoffUntil = now + (failClass === 'plinth_attended' || failClass === 'plinth_lease' ? PLINTH_COOLDOWN_MS : PLINTH_BACKOFF_MS)
  return s
}

/** A town that already carries this many unresolved plinth columns starts no new plan (each is a column every path prices
 *  out and every visitor watches; none is ever forgotten to make room). */
export const PLINTH_PREV_MAX = 32
/**
 * THE COLUMNS A NEW RECORD MUST KEEP WATCHING -> [cap]. Pure. The old record's plan cap (plan, void or complete) and its
 * own `prev`, deduplicated, keeping only those whose column is still a hazard or cannot be read (`hazardOf(cap)` true or
 * null; the caller judges the column WITH ITS CAP CELL OPEN, since a cover is one block a gatherer may take): a part-built
 * plinth whose column could trap no body is a block of cobble and is let go; one that may trap a body is never forgotten
 * by a replan or a failed search (Codex r1 P1-3). The new plan's own cap is not one of them.
 */
export function carryPrev (rec, hazardOf, newCap = null, extra = []) {
  const caps = []
  if (rec?.plan?.cap) caps.push({ ...rec.plan.cap, stair: Array.isArray(rec.plan.stair) ? rec.plan.stair : [] })
  for (const c of (Array.isArray(rec?.prev) ? rec.prev : [])) caps.push(c)
  // plinthfirst-01: columns the record never planned but must not forget (the replaced well site's pit), judged the same way
  for (const c of (Array.isArray(extra) ? extra : [])) caps.push(c)
  const out = []
  for (const c of caps) {
    if (!c || !Number.isFinite(c.x) || !Number.isFinite(c.y) || !Number.isFinite(c.z)) continue
    if (newCap && c.x === newCap.x && c.y === newCap.y && c.z === newCap.z) continue
    if (out.some(o => o.x === c.x && o.y === c.y && o.z === c.z)) continue
    if (hazardOf(c) === false) continue
    // ITS STAIR TOO (Codex r2 P2-4): the way up to cover it stays a cell no path or gather digs
    out.push({ x: c.x, y: c.y, z: c.z, stair: (Array.isArray(c.stair) ? c.stair : []).filter(a => Array.isArray(a) && a.length === 3) })
  }
  // NEVER EVICTED to fit a limit (Codex r2 P2-4): at PLINTH_PREV_MAX the town plans nothing more (the caller's refusal)
  return out
}
/** Visits that made no progress on the same step before the plan is voided and replanned (Claude r1 P2-1). */
export const PLINTH_STUCK_VISITS = 3
/** The record's stall counter after a visit -> { step, n } | null. Pure: progress clears it; no progress on the same
 *  first-remaining step counts up; a different step starts again at 1. */
export function stuckNext (stuck, { step, progressed }) {
  if (progressed || step == null) return null
  return stuck && stuck.step === step ? { step, n: (Number(stuck.n) || 0) + 1 } : { step, n: 1 }
}

/** THE _plinth ROW, key=value, stage first (the read parses fields): cut at 300. */
export function plinthDetail ({ stage, at = null, k = null, placed = 0, cleared = 0, done = null, total = null, left = null, budget = null,
                                took = 0, why = null, hazard = null, id = null, tally = null, alt = 0, retries = 0 } = {}) {
  return (`stage=${stage}${at ? ` at=${at.x},${at.y},${at.z}` : ''}${k != null ? ` k=${k}` : ''} placed=${placed} cleared=${cleared} alt=${alt} retries=${retries}` +
          `${done != null ? ` done=${done}/${total}` : ''}${left != null ? ` left=${left}` : ''}${budget != null ? ` budget=${budget}` : ''}` +
          ` took=${took}${hazard != null ? ` hazard=${hazard ? 1 : 0}` : ''}${id ? ` id=${id}` : ''}${tally ? ` tally=${tally}` : ''}` +
          `${why ? ` why=${String(why).replace(/\s+/g, '_').slice(0, 120)}` : ''}`).slice(0, 300)
}

// ---- PLINTH-FIRST (plinthfirst-01; OWNER 10-16 ~12:05Z "every new junk well self-built? -> yes") ---------------------------
//
// Every NEW junk well is a raised one and the natural-site search is skipped. A sealed natural well keeps being used until it
// breaks (build_well's `exists` and plinthWant's wellUsable come first: nothing is torn down, nobody digs in town). The one
// place the natural search ran is build_well's site resolution (skills.mjs townWellSite): under plinth-first its search
// answers "exhausted" at once (plinthFirstSearch) and a recorded natural site nothing has been dug at is refused
// (plinthFirstRefusal), so build_well writes the town's existing no-site record and plinth-02's own trigger (plinthWant
// 'no_site') plans the plinth. Everything after that -- the 2 h hold, the hand-off, build_well finishing the well on the cap,
// complete_lost and void -- is plinth-02's, unchanged. Measured 10-17: no town without a usable well had a natural site the
// search could find (all 4 shared no-well towns and all 20 isolated bots exhausted), so on that fleet this changes no town;
// it decides what replaces the next natural well that breaks (~4 natural re-sites in 12 days).
/** THE SWITCH. Revert = false (or PLINTH_FIRST=0 in a bot's environment, which the natural-search tests use). */
export const PLINTH_FIRST = true
/**
 * IS PLINTH-FIRST IN FORCE FOR THIS BOT? Pure. Never where the town's records are not one town's (townRecordsShared: a plinth
 * there has no single builder, so plinthWant refuses it and the bot keeps the natural search).
 */
export function plinthFirstPolicy ({ scope = null, pool = '', name = '', env = null } = {}) {
  if (!PLINTH_FIRST || !townRecordsShared({ scope, pool, name })) return false
  return String(env?.PLINTH_FIRST ?? '') !== '0'
}
/** How long a planner's 'none' hands the town back to the natural search before plinth-first is tried again (Claude r3 P2-1:
 *  otherwise one failed plan -- furniture, a keep-out, too_many_unresolved, all of which change -- took a town off for good). */
export const PLINTH_FIRST_NONE_WINDOW_MS = 24 * 60 * 60 * 1000
/**
 * IS PLINTH-FIRST IN FORCE NOW (the natural search declined; no usable well is the plinth trigger)? Pure. The policy
 * (plinthFirstPolicy), except while a planner's 'none' (incl. too_many_unresolved) is younger than PLINTH_FIRST_NONE_WINDOW_MS:
 * then the town has the natural search back (Claude r1 P2-1: the plinth candidate is stricter than the natural site -- hard
 * ground, an enclosed void, a walkable stand -- so a town the planner cannot serve would otherwise get no well at all). The
 * MINIMUM RAISE of any new plan follows the POLICY, not this (Codex r3 P2-2: a replan out of 'none' is still raised).
 */
export function plinthFirstOn ({ scope = null, pool = '', name = '', env = null, recState = null, recAt = null, now = 0 } = {}) {
  if (!plinthFirstPolicy({ scope, pool, name, env })) return false
  if (recState === 'none') {
    const age = recAt == null ? NaN : now - Number(recAt)
    if (!(Number.isFinite(age) && age >= PLINTH_FIRST_NONE_WINDOW_MS)) return false
  }
  return true
}
/** THE LICENCE ROW (plinthfirst-01): `_plinthfirst_mode`, once per spawn (index.mjs), a kind neither the base nor plinth-02
 *  writes. CONFIGURATION, not the effective policy at a later build (Codex r2 P2-4): policy=1 where plinth-first is configured;
 *  shared=0 names a bot whose town records are its own (no plinth there at all). The effective state is on each dig (pf=). */
export const plinthFirstModeDetail = ({ on = false, shared = true, worldId = null } = {}) =>
  `phase=mode v=1 policy=${on ? 1 : 0} shared=${shared ? 1 : 0} minraise=${PLINTH_FIRST_MIN_RAISE} lost=evidence dy=${PLINTH_ORDER_DY} w=${String(worldId || '-').slice(0, 40)}`
/**
 * THE RAISE A PLINTH-FIRST PLAN STARTS FROM (plinthfirst-01 r3). plinth-02's planner takes the cheapest candidate, and on
 * ground that still seals a well that is k = 0 with NOTHING placed -- the natural cell itself, which is not "self-built" and
 * fails as natural wells fail (10-15/16: board-b wall_is_air, placebo-b wall_is_sand). From k = 2 every one of the 8 walls
 * the seal is judged on (g and g-1) is a PLACED cobblestone (+32 blocks on intact ground). A town where no candidate fits
 * from k = 2 records 'none', and plinthFirstOn hands it back to the natural search.
 */
export const PLINTH_FIRST_MIN_RAISE = 2
/**
 * THE RAISE A NEW PLAN STARTS FROM -> { minK, bare }. Pure (Claude r4 P2-1: a town where only k = 1 fits must not be left with
 * no well). Off the policy: plinth-02's own planner (k >= 0, the bare cell allowed). Under it: k >= PLINTH_FIRST_MIN_RAISE
 * first; once a plan at that floor found nothing (a 'none' record that says minK >= 2) AND the natural search has since
 * exhausted too (a no-site record newer than the none), the floor drops to 0 -- and a candidate that places nothing (the
 * natural cell, leaf clears or not) is never a plan under the policy, so the drop adds a k = 1 raise or a k = 0 repair with
 * blocks placed.
 */
export function plinthFirstMinK ({ policy = false, recState = null, rec = null, noSite = null } = {}) {
  if (!policy) return { minK: 0, bare: true }
  const ladder = recState === 'none' && Number(rec?.minK) >= PLINTH_FIRST_MIN_RAISE && Number(noSite?.at) > Number(rec?.at)
  return { minK: ladder ? 0 : PLINTH_FIRST_MIN_RAISE, bare: false }
}
export const PLINTH_FIRST_WHY = 'natural junk well sites are declined: every new junk well is a raised one (plinth-first)'
/**
 * THE SEARCH UNDER PLINTH-FIRST -> canonicalWellSite's exhausted shape. Pure. `shadow` is the natural search's own answer,
 * READ ONLY (Claude r1 Q5): never recorded, never built -- the row says what plinth-first declined (`shadow=x,y,z`), which is
 * this change's exposure (a natural cell the base would have used), or `none` / `unknown`.
 */
export function plinthFirstSearch (shadow = null) {
  // AN UNREAD CELL IS STILL A DEFERRAL (Codex r1 P2-5): the base's search told unknown ground from exhausted ground, and only
  // the exhausted answer writes the town's no-site record -- so a shadow search that hit an unloaded cell defers here too
  if (shadow && !shadow.site && !shadow.exhausted) return { site: null, why: shadow.why ?? 'unknown cell near home', exhausted: false, tally: shadow.tally ?? null, shadow: 'unknown' }
  const sh = shadow?.site ? `${shadow.site.x},${shadow.site.y},${shadow.site.z}` : shadow?.exhausted ? 'none' : '-'
  return { site: null, why: PLINTH_FIRST_WHY, exhausted: true, tally: { cols: 0, plinth_first: 1 }, shadow: sh }
}
/**
 * IS EVERY CHUNK AROUND HOME LOADED? -> true | false. Pure: read(x, y, z) null = not sent. Sampled every 8 blocks across the
 * square of side 2r (a chunk is 16 wide, so every chunk the square touches is sampled): the well is found by a block scan
 * of loaded chunks only (skills.mjs findTownWells, ADOPT_RADIUS), so "no well" is evidence only over loaded ground.
 */
export function areaLoaded (read, home, r = ADOPT_RADIUS) {
  if (typeof read !== 'function' || !home) return false
  const y = Math.floor(home.y ?? 64)
  for (let dx = -r; dx <= r; dx += 8) for (let dz = -r; dz <= r; dz += 8) if (!read(Math.floor(home.x) + dx, y, Math.floor(home.z) + dz)) return false
  return true
}
export const PLINTH_FIRST_NATURAL = 'a natural site: every new junk well is a raised one (plinth-first)'
export const PLINTH_FIRST_OLD = 'an earlier raised well the town replanned away from (plinth-first)'
/** A natural pit something was already dug at (well.mjs wellStage): finished, never orphaned. Anything else is refused. */
const STARTED_PIT = new Set(['half_dug', 'dug', 'floored', 'covered', 'covered_floored'])
/** The cap of this world's current plinth plan (record state plan or complete), or null. Pure. */
export function plinthPlanCap (rec, world = null) {
  const st = plinthRecordState(rec, world)
  return st === 'plan' || st === 'complete' ? { x: rec.plan.cap.x, y: rec.plan.cap.y, z: rec.plan.cap.z } : null
}
/**
 * MAY build_well BUILD ON THIS RECORDED SITE UNDER PLINTH-FIRST? -> reason | null (it may). Pure; asked AFTER wellSiteRefusal
 * passed it (an unknown cell is still that rule's deferral).
 *   on        plinthFirstOn
 *   planCap   plinthPlanCap of the town's record: the raised well's own cap is always buildable
 *   oldCaps   every other plinth column the record carries (prev): a cap the town replanned away from is never finished
 *             under the new plan's feet (Claude r1 P1-1: two half-wells)
 *   stage     well.mjs wellStage of the site: a natural pit already dug (half_dug .. covered_floored) is FINISHED, never
 *             orphaned. Only a natural site nothing was dug at ('fresh') is refused.
 */
export function plinthFirstRefusal ({ on = false, site = null, planCap = null, oldCaps = [], stage = null } = {}) {
  if (!on || !site) return null
  const at = c => !!c && c.x === site.x && c.y === site.y && c.z === site.z
  if (at(planCap)) return null
  if ((Array.isArray(oldCaps) ? oldCaps : []).some(at)) return PLINTH_FIRST_OLD
  if (STARTED_PIT.has(stage)) return null
  return PLINTH_FIRST_NATURAL
}
/** IS A RECORDED SITE A NATURAL PIT build_well IS FINISHING? Pure: plinthWant's `naturalPit` -- no plinth plan while one is. */
export const naturalPitPending = ({ on = false, site = null, planCap = null, oldCaps = [], stage = null, refusal = 'x' } = {}) =>
  !!on && !!site && refusal === null && STARTED_PIT.has(stage) && plinthFirstRefusal({ on, site, planCap, oldCaps, stage }) === null &&
  !(planCap && planCap.x === site.x && planCap.y === site.y && planCap.z === site.z)

export const isPlinthBlock = name => PLINTH_SET.has(name)
/** A block a pit is covered with (well.mjs PIT_COVER_BLOCKS: what coverPit / coverPlinthPit place): the only block the
 *  build ever digs out of a plan's cap cell. Pure. */
export const isPitCover = b => !!b && (PIT_COVER_BLOCKS.includes(b.name) || COVER_BECOMES.has(b.name))
/** What a cover turns into on its own (Claude r5 P2): grass and mycelium spread onto a dirt cover under open sky. */
const COVER_BECOMES = new Set(['grass_block', 'mycelium', 'podzol'])
export { RESERVE_STONE }
