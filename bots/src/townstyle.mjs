// TOWNSTYLE-01: THE TOWN'S STYLE LIBRARY (OWNER 2026-11-04: "can we put some design charm into the buildings and not have flat roofs,
// lets make them have angled roofs etc, to make it look more like a town not just blocks with doors"; design
// docs/reports/townstyle-design-2026-11-04.md on main, Claude + Codex). PURE: no bot, no world, no files.
//
// TWO HALVES:
//   1. ORIENTATION -- a blueprint cell may carry a block STATE (`st`) in the blueprint's LOCAL frame (+u / -u / +v / -v; the front is
//      -v, the doorway's side). worldState() turns it into the world state for the record's orientation (townplan.mjs rot). orientAim()
//      says how ONE click produces that state from ONE support face, or refuses: vanilla 1.21's placement rules, proven on Paper 1.21.8
//      by sandbox/townstyle/orient-proof.mjs (docs/reports/townstyle-2026-11-04/paper-orient.txt):
//        stairs    facing = the player's horizontal look (its YAW, not the face clicked); half = top when the clicked face is the
//                  underside, or a side face clicked above its middle; a top face click is always bottom
//        slabs     type = top / bottom by the same rule (never double: a record cell is placed only into air)
//        logs      axis = the clicked face's axis (a top face: y; an east/west face: x; a north/south face: z)
//        trapdoor  a side face click: facing = the clicked face's outward direction, half by the cursor's height; open = false
//        lantern   hanging when clicked on an underside, standing on a top face
//      The yaw a stair needs is SENT AS ITS OWN LOOK PACKET immediately before the block_place, synchronously (buildbot.mjs send with an
//      `aim`): mineflayer's lookAt(force) only queues the look for its next physics tick, so a click sent in the same tick would be
//      judged with the OLD yaw (the proof's control arm shows it). A state that no support face of the cell can make is no step
//      (the cell waits for a stand/support that can; buildsite.mjs stepFor with a state).
//      stateOk() is the DONE rule: every property the cell names must read so (shape, waterlogged and the rest are the server's).
//   2. SHAPES -- the roof forms and trims every blueprint generator uses (gable roofs from stairs + slabs with eaves, gable-end walls,
//      log corner posts, a stone foundation course, sills, porches, lights) and the per-building SEEDED choices. See the second half.

import { rot } from './townplan.mjs'
import { windowPalette, GLASS } from './glass.mjs'   // glass-01: the window palette blueprints share

const nm = b => String(b?.name ?? '').replace(/\[.*\]$/, '')

// ---- 1. ORIENTATION ---------------------------------------------------------------------------------------------------------
/** The local directions and their (du, dv). */
export const LOCAL_DIRS = Object.freeze({ '+u': [1, 0], '-u': [-1, 0], '+v': [0, 1], '-v': [0, -1] })
/** World facing names by (dx, dz). */
const FACING_OF = { '1,0': 'east', '-1,0': 'west', '0,1': 'south', '0,-1': 'north' }
/** The notchian yaw (degrees) that faces a world direction: south 0, west 90, north 180, east -90 (Direction.fromYRot). */
export const YAW_OF = Object.freeze({ south: 0, west: 90, north: 180, east: -90 })
/** The opposite of a local direction. */
export const oppLocal = d => ({ '+u': '-u', '-u': '+u', '+v': '-v', '-v': '+v' })[d]

/** A local direction ('+u' ...) under an orientation -> the world facing ('north' ...). Pure. */
export function worldFacing (orient, ldir) {
  const d = LOCAL_DIRS[ldir]
  if (!d) throw new Error(`local direction ${ldir}`)
  const { dx, dz } = rot(orient, d[0], d[1])
  return FACING_OF[`${Math.sign(dx)},${Math.sign(dz)}`]
}
/** A local axis ('u' | 'v' | 'y') under an orientation -> the world axis ('x' | 'z' | 'y'). Pure. */
export function worldAxis (orient, laxis) {
  if (laxis === 'y') return 'y'
  const { dx } = laxis === 'u' ? rot(orient, 1, 0) : rot(orient, 0, 1)
  return dx !== 0 ? 'x' : 'z'
}
/**
 * A cell's LOCAL state -> its WORLD state for the record's orientation. Pure. Keys: facing (a local direction), axis (u|v|y), half,
 * type (top|bottom), hanging (bool). Any other key passes through as written. null / {} -> null (a cell with no state).
 */
export function worldState (st, orient) {
  if (!st || typeof st !== 'object' || !Object.keys(st).length) return null
  const out = {}
  for (const [k, v] of Object.entries(st)) {
    if (k === 'facing') out.facing = worldFacing(orient, v)
    else if (k === 'axis') out.axis = worldAxis(orient, v)
    else out[k] = v
  }
  return out
}
/** The state a name + properties spell, the way /setblock and `execute if block` write it: `oak_stairs[facing=north,half=top]`. */
export const stateKey = (name, st) => (st && Object.keys(st).length ? `${name}[${Object.keys(st).sort().map(k => `${k}=${st[k]}`).join(',')}]` : String(name))

// the kinds of block whose placement state a click decides
export const STAIRS = /_stairs$/
export const SLAB = /_slab$/
export const AXIS = /(_log|_wood|_stem|_hyphae)$|^(quartz_pillar|purpur_pillar|hay_block|bone_block|basalt|polished_basalt|chain|bamboo_block|stripped_bamboo_block)$/
export const TRAPDOOR = /_trapdoor$/
export const LANTERN = /^(soul_)?lantern$/
/** Does a click decide this block's state (so a cell of it should carry one)? Pure. */
export const oriented = name => STAIRS.test(name) || SLAB.test(name) || AXIS.test(name) || TRAPDOOR.test(name) || LANTERN.test(name)

const faceName = f => (f[1] > 0 ? 'up' : f[1] < 0 ? 'down' : FACING_OF[`${f[0]},${f[2]}`])
const axisOfFace = f => (f[1] !== 0 ? 'y' : f[0] !== 0 ? 'x' : 'z')
export const HALF_UP = 0.75
export const HALF_DOWN = 0.25
/**
 * HOW ONE CLICK MAKES A STATE -> { yaw, cursor } | null. Pure.
 *   name   the block placed; ws its WORLD state (worldState) or null
 *   face   the clicked face's outward normal [fx, fy, fz] (from the support INTO the cell: buildsite.mjs stepFor's `face`)
 *   yaw    the notchian yaw to send before the click (a stair's facing), or null (any)
 *   cursor the click point on the support, in the support's own block (0..1 each): the face's centre, its height moved to HALF_UP or
 *          HALF_DOWN on a side face when the state has a half
 * null when no click on THAT face can make the state (a top half from a top face, an x log from a z face, a trapdoor from a top face,
 * a double slab ever, a lantern hanging from a top face ...).
 */
export function orientAim (name, ws, face) {
  const n = String(name ?? '')
  const side = face[1] === 0
  const centre = [0.5 + face[0] * 0.5, 0.5 + face[1] * 0.5, 0.5 + face[2] * 0.5]
  const plain = { yaw: null, cursor: centre }
  if (!ws) return plain
  const fn = faceName(face)
  const halfCursor = half => {
    if (half == null) return centre
    if (side) return [centre[0], half === 'top' ? HALF_UP : HALF_DOWN, centre[2]]
    // a top face (support below) always makes the bottom half; an underside (support above) the top half
    if ((fn === 'up' && half !== 'bottom') || (fn === 'down' && half !== 'top')) return null
    return centre
  }
  if (STAIRS.test(n)) {
    if (ws.facing && YAW_OF[ws.facing] == null) return null
    const cursor = halfCursor(ws.half)
    return cursor ? { yaw: ws.facing ? YAW_OF[ws.facing] : null, cursor } : null
  }
  if (SLAB.test(n)) {
    if (ws.type === 'double') return null
    const cursor = halfCursor(ws.type)
    return cursor ? { yaw: null, cursor } : null
  }
  if (AXIS.test(n)) {
    if (ws.axis && ws.axis !== axisOfFace(face)) return null
    return plain
  }
  if (TRAPDOOR.test(n)) {
    if (!side) return null
    if (ws.facing && ws.facing !== fn) return null
    if (ws.open === true || ws.open === 'true') return null
    const cursor = halfCursor(ws.half)
    return cursor ? { yaw: null, cursor } : null
  }
  if (LANTERN.test(n)) {
    const hanging = ws.hanging === true || ws.hanging === 'true'
    if (hanging ? fn !== 'down' : fn !== 'up') return null
    return plain
  }
  return plain
}
/**
 * WOULD THIS CLICK MERGE INTO ITS SUPPORT? -> bool. Pure. A slab held against a SUPPORT that is the same slab, half full, replaces the
 * SUPPORT (vanilla SlabBlock.canBeReplaced: a bottom slab clicked on its top face or on a side above its middle, a top slab on its
 * underside or a side below its middle) -- the support becomes a double slab and the target cell stays air (LIVE Paper 11-05, hall@2's
 * 1:2 roof: 52 reorient digs, the roof edge never finished). Unknown support properties: true (refused: never guessed).
 */
export function slabMerges (held, support, face, cursorY) {
  if (!SLAB.test(String(held ?? '')) || nm(support) !== String(held)) return false
  const t = propsOf(support)?.type
  if (t === 'double') return false
  if (t !== 'bottom' && t !== 'top') return true
  const side = face[1] === 0
  if (t === 'bottom') return face[1] > 0 || (side && cursorY > 0.5)
  return face[1] < 0 || (side && cursorY <= 0.5)
}
/**
 * IS THE CELL'S STATE RIGHT? -> bool. Pure. `props` the block's properties as the world reports them (prismarine-block getProperties:
 * booleans as booleans, the rest strings); `ws` the world state the cell names. Every named property must read the same; the ones it
 * does not name (a stair's shape, waterlogged) are the server's. No state named: true.
 */
export function stateOk (props, ws) {
  if (!ws) return true
  if (!props || typeof props !== 'object') return false
  for (const [k, v] of Object.entries(ws)) if (String(props[k]) !== String(v)) return false
  return true
}
/** A world state as a build row's `st` field: its values by key order, '/'-joined (`facing=north,half=bottom` -> `north/bottom`). Pure. */
export const stateTag = ws => (ws ? Object.keys(ws).sort().map(k => String(ws[k])).join('/') : '-')
/** The world block's properties, from a read that may carry them (`props`, or a prismarine Block's getProperties). Pure. */
export function propsOf (b) {
  if (!b) return null
  if (b.props && typeof b.props === 'object') return b.props
  if (typeof b.getProperties === 'function') { try { return b.getProperties() } catch { return null } }
  return null
}
/** Is this read the cell's block family but in the WRONG state (a misoriented placement to take down and place again)? Pure. */
export const misoriented = (b, ws) => !!ws && !!nm(b) && nm(b) !== 'air' && !stateOk(propsOf(b), ws)

// ---- 2. SHAPES ----------------------------------------------------------------------------------------------------------------
// A blueprint's cells are { u, v, y, role, seg, st? } (st: the LOCAL state above). The palette may name STYLE TOKENS -- '%wood' (the
// record's wood species: spruce, oak ...), '%roof' (the roof's species), '%stone' (the foundation's block) -- resolved ONCE, at siting,
// into the record's own palette (stylePalette), so a repair never re-rolls and one roof is never two woods (Codex design 11-04).

/** The wood species that have stairs, slabs, logs and trapdoors (overworld + nether stems excluded: no logs to fell). */
export const WOODS = Object.freeze(['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry', 'pale_oak'])
/** The foundation stones a style may pick (each has its own stairs and slab). */
export const STONES = Object.freeze(['cobblestone', 'stone_bricks'])
/** A palette with its style tokens resolved -> a new palette. Pure. '%wood_planks' -> 'spruce_planks'; '%stone' -> 'cobblestone'. */
export function stylePalette (palette, style = {}, { glass = GLASS.on } = {}) {
  const wood = style.wood ?? 'oak', roof = style.roof ?? wood, stone = style.stone ?? 'cobblestone'
  const sub = s => String(s).replace(/%roof/g, roof).replace(/%wood/g, wood).replace(/%stone/g, stone)
  const out = {}
  // glass-01 (Codex show r1 BLOCKER): GLASS=off sites a window as before -- glass, else the wall (no trapdoor fallback)
  for (const [k, v] of Object.entries(palette ?? {})) out[k] = [...new Set((v ?? []).filter(c => glass || !(v[0] === 'glass_pane' && c === '%wood_trapdoor')).map(sub))]
  return out
}
/** A small stable hash of a string -> uint32 (FNV-1a). Pure. The seeded choices' coin. */
export function seedOf (s) {
  let h = 0x811c9dc5
  for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0 }
  return h >>> 0
}
/** The log name of a species ('crimson'/'warped' would be stems: not in WOODS). */
export const logOf = w => `${w}_log`
/**
 * THE STYLE A BUILDING TAKES AT SITING -> { wood, roof, stone, variant }. Pure. `town` the indexed stock { name: n }, `need` the logs
 * the building's wood takes (walls, posts, roof together), `key` the building's stable id (pool/plot/plot id: the seed), `variants`
 * the blueprint variants to choose among. THE WOOD is the town's most-stocked log species (the one it can build from); THE ROOF the
 * darkest species DARKER than the walls of which the town holds at least `need.roof` logs (a dark roof over lighter walls: the town's
 * one rule of contrast), else the wall wood; THE STONE stone bricks when the town holds `need.stone` of them and the seed says so,
 * else cobblestone; THE VARIANT by the seed.
 */
export const DARKNESS = Object.freeze(['dark_oak', 'mangrove', 'spruce', 'jungle', 'acacia', 'oak', 'cherry', 'birch', 'pale_oak'])
export function styleOf (town = {}, { key = '', need = { wall: 0, roof: 0, stone: 0 }, variants = ['s'] } = {}) {
  const n = name => Number(town?.[name]) || 0
  const stocked = WOODS.filter(w => n(logOf(w)) > 0).sort((a, b) => n(logOf(b)) - n(logOf(a)) || WOODS.indexOf(a) - WOODS.indexOf(b))
  const wood = stocked[0] ?? 'oak'
  const seed = seedOf(key)
  const darker = DARKNESS.slice(0, Math.max(0, DARKNESS.indexOf(wood)))
  const roof = (need.roof ?? 0) > 0 ? darker.find(w => n(logOf(w)) >= need.roof) ?? wood : wood
  const stone = n('stone_bricks') >= (need.stone ?? 0) && (need.stone ?? 0) > 0 && (seed & 1) ? 'stone_bricks' : 'cobblestone'
  const variant = variants[(seed >>> 1) % variants.length]
  return { wood, roof, stone, variant }
}

/**
 * A GABLE ROOF over a wall box -> cells [{ u, v, y, role, seg, st }]. Pure.
 *   box      { u0, u1, v0, v1 } the WALL lines (inclusive); yTop the wall's top course
 *   ridge    'u' (the ridge runs along u: the slopes face -v and +v, the gables are the u0 / u1 walls) or 'v'
 *   over     the overhang beyond the walls on every side (eaves and the gable ends)
 * Each slope course is a row of BOTTOM stairs one up and one in from the one below, its tall side toward the ridge; an odd span ends
 * in a ridge row of BOTTOM slabs (role `ridge`), an even span in the two top courses back to back. The eave course sits at yTop beside
 * the wall's top course (the overhang), the next one ON the wall's top course. THE GABLE ENDS: every cell of the end walls' lines
 * under the roof (role `gable`), so the roof's end cells sit on them and the attic is closed. Segments: `roof-edge` (the courses up to
 * yTop + 1), `roof-inner` (the rest, the ridge last), `gable` (the end fill) -- both roof segments are buildrun's CLOSERS.
 */
export function gableRoof ({ u0, u1, v0, v1 }, yTop, { ridge = 'u', over = 1, stairRole = 'roof', ridgeRole = 'ridge', gableRole = 'gable', edgeTop = 1 } = {}) {
  const cells = []
  // the slope axis is the one across the ridge: s; the ridge axis: r
  const s0 = (ridge === 'u' ? v0 : u0) - over, s1 = (ridge === 'u' ? v1 : u1) + over
  const r0 = (ridge === 'u' ? u0 : v0) - over, r1 = (ridge === 'u' ? u1 : v1) + over
  const heightAt = s => yTop + Math.min(s - s0, s1 - s)
  const odd = (s1 - s0) % 2 === 0
  const mid = (s0 + s1) / 2
  const put = (s, r, y, role, seg, st) => { const c = ridge === 'u' ? { u: r, v: s } : { u: s, v: r }; cells.push({ ...c, y, role, seg, ...(st ? { st } : {}) }) }
  for (let s = s0; s <= s1; s++) {
    const y = heightAt(s)
    const seg = y <= yTop + edgeTop ? 'roof-edge' : 'roof-inner'
    for (let r = r0; r <= r1; r++) {
      if (odd && s === mid) { put(s, r, y, ridgeRole, 'roof-inner', { type: 'bottom' }); continue }
      // the tall side toward the ridge: below the middle the stair faces +s, above it -s
      const toward = s < mid ? '+' : '-'
      put(s, r, y, stairRole, seg, { facing: `${toward}${ridge === 'u' ? 'v' : 'u'}`, half: 'bottom' })
    }
  }
  // the gable ends: the end walls' lines (r = the wall lines), under every roof cell of the span strictly inside the walls
  const ends = ridge === 'u' ? [u0, u1] : [v0, v1]
  const sIn0 = ridge === 'u' ? v0 : u0, sIn1 = ridge === 'u' ? v1 : u1
  for (const r of ends) for (let s = sIn0 + 1; s <= sIn1 - 1; s++) for (let y = yTop + 1; y < heightAt(s); y++) put(s, r, y, gableRole, 'gable')
  return cells
}

/**
 * THE COTTAGE (house@2's successor for the owner's 11-04 ask; townstyle-01's first building) -> the blueprint object. Pure.
 * A 7 x 7 pad (the house plot's footprint), a 5 x 5 timber-framed room 3 high: a stone FOUNDATION COURSE (y 1), plank walls (y 2-3),
 * LOG CORNER POSTS (y 1-3, axis y), glass windows with closed-trapdoor SILLS outside, wall TORCHES either side of the door, a torch
 * inside; a 45-degree GABLE ROOF of stairs with one block of eaves all round, a slab ridge, filled gable ends with an attic window.
 *   variant 's': the ridge along u -- the front (v 0, the doorway's side) is an EAVE side, the gables face the sides
 *   variant 'f': the ridge along v -- the front is a GABLE (the door under the attic window: the classic cottage front)
 * The roof's top is y 6 (the ridge slab): every roof cell has a stand within reach -- the eaves from the pad outside, the upper courses
 * from the floor inside under the open attic (no ceiling), the end overhangs from the pad beyond the gables (buildsite.mjs proveSite).
 */
export const COTTAGE = Object.freeze({ W: 7, D: 7, wall: { u0: 1, u1: 5, v0: 1, v1: 5 }, yTop: 3, door: 3 })
export function cottageBlueprint (variant = 's') {
  const { W, D, wall: B, yTop, door } = COTTAGE
  const cells = []
  const add = (u, v, y, role, seg, st) => cells.push({ u, v, y, role, seg, ...(st ? { st } : {}) })
  for (let u = 0; u < W; u++) for (let v = 0; v < D; v++) add(u, v, 0, 'base', 'pad')
  const sideOf = (u, v) => (v === B.v0 ? 'F' : v === B.v1 ? 'B' : u === B.u0 ? 'L' : 'R')
  const corner = (u, v) => (u === B.u0 || u === B.u1) && (v === B.v0 || v === B.v1)
  const perim = []
  for (let u = B.u0; u <= B.u1; u++) for (let v = B.v0; v <= B.v1; v++) if (u === B.u0 || u === B.u1 || v === B.v0 || v === B.v1) perim.push([u, v])
  // the windows (y 2): on the eave sides and the back for 's'; the sides and the back for 'f' -- never beside the door, whose wall
  // carries the torches. Each window's sill is a closed trapdoor (top half) on the stone course's outer face, below it.
  const mid = (B.v0 + B.v1) / 2, midU = (B.u0 + B.u1) / 2
  const windows = variant === 'f'
    ? [[B.u0, mid], [B.u1, mid], [midU, B.v1]]
    : [[B.u0, mid], [B.u1, mid], [B.u0 + 1, B.v1], [B.u1 - 1, B.v1]]
  const isWin = (u, v) => windows.some(([a, b]) => a === u && b === v)
  for (const [u, v] of perim) {
    const seg = `wall-${sideOf(u, v)}`
    const doorway = v === B.v0 && u === door
    for (let y = 1; y <= yTop; y++) {
      if (doorway && y <= 2) continue
      if (corner(u, v)) { add(u, v, y, 'post', seg, { axis: 'y' }); continue }
      if (y === 1) { add(u, v, y, 'course', seg); continue }
      if (y === 2 && isWin(u, v)) { add(u, v, y, 'window', seg); continue }
      add(u, v, y, 'wall', seg)
    }
  }
  const roof = gableRoof(B, yTop, { ridge: variant === 'f' ? 'v' : 'u', over: 1 })
  // the attic window: the middle gable cell one above the wall top, on each gable end
  for (const c of roof) if (c.role === 'gable' && c.y === yTop + 1 && (variant === 'f' ? c.u === midU : c.v === mid)) c.role = 'gablewin'
  cells.push(...roof)
  // FIT-OUT: a torch inside (the house@1 spot), a wall torch either side of the door (on the front wall's outer face, y 2), the sills
  add(B.u0 + 1, B.v1 - 1, 1, 'light', 'fit-out')
  add(door - 1, B.v0 - 1, 2, 'light', 'fit-out')
  add(door + 1, B.v0 - 1, 2, 'light', 'fit-out')
  for (const [u, v] of windows) {
    const out = u === B.u0 ? [-1, 0, '-u'] : u === B.u1 ? [1, 0, '+u'] : v === B.v1 ? [0, 1, '+v'] : [0, -1, '-v']
    add(u + out[0], v + out[1], 1, 'sill', 'fit-out', { facing: out[2], half: 'top', open: false })
  }
  // REACH-ONLY ABOVE THE EYE: from the floor (feet y 1, eye y 2.62) a top face at y 3 or higher is above the eye, and nothing a bot
  // stands on is higher; Paper places on reach alone (sandbox/townstyle/orient-proof.mjs --scene=blind), so every cell from y 3 up is
  // `blind` (buildsite.mjs stepFor: the reach rule only, no eye side, no sight line)
  for (const c of cells) if (c.y >= yTop) c.blind = true
  const interior = []
  for (let u = B.u0 + 1; u <= B.u1 - 1; u++) for (let v = B.v0 + 1; v <= B.v1 - 1; v++) for (const y of [1, 2]) interior.push([u, v, y])
  interior.push([door, B.v0, 1], [door, B.v0, 2])
  return {
    id: `cottage@1${variant}`,
    kind: 'house',
    footprint: { u: W, v: D },
    pad: { w: W, d: D },
    front: { u: door, v: 0, note: 'townstyle-01: the open doorway (u 3, v 1, y 1-2) opens toward v < 0, like house@1' },
    doorway: [[door, B.v0, 1], [door, B.v0, 2]],
    interior,
    palette: {
      base: ['%stone', 'cobblestone', 'stone_bricks'],
      course: ['%stone', 'cobblestone', 'stone_bricks'],
      post: ['%wood_log'],
      wall: ['%wood_planks', '$planks'],
      // glass when the town has it, else the wall's planks (house@1's rule: a window never stalls the house)
      window: windowPalette('$wall'),   // glass-01: glass, else a trapdoor of the walls' wood, else the wall
      gable: ['%wood_planks', '$planks'],
      gablewin: windowPalette('$gable'),
      roof: ['%roof_stairs'],
      ridge: ['%roof_slab'],
      sill: ['%wood_trapdoor'],
      light: ['torch'],
    },
    segments: [
      { seg: 'pad', layer: 0, deps: [] },
      { seg: 'wall-F', layer: 1, deps: ['pad'] },
      { seg: 'wall-B', layer: 1, deps: ['pad'] },
      { seg: 'wall-L', layer: 1, deps: ['pad'] },
      { seg: 'wall-R', layer: 1, deps: ['pad'] },
      { seg: 'gable', layer: 2, deps: ['wall-F', 'wall-B', 'wall-L', 'wall-R'] },
      { seg: 'roof-edge', layer: 3, deps: ['gable'] },
      { seg: 'roof-inner', layer: 4, deps: ['roof-edge'] },
      { seg: 'fit-out', layer: 5, deps: ['roof-inner'] },
    ],
    structural: ['base', 'course', 'post', 'wall', 'gable', 'roof', 'ridge'],
    cells,
    note: `townstyle-01 (owner 11-04 "angled roofs"): generated by bots/scripts/make-cottage.mjs from bots/src/townstyle.mjs cottageBlueprint('${variant}'); do not edit by hand`,
  }
}

// ---- 3. THE WOOD PARTS A VISIT CRAFTS ------------------------------------------------------------------------------------------
/** What one craft makes and takes: stairs 6 planks -> 4, slabs 3 planks -> 6, trapdoors 6 planks -> 2 (all at a table). */
export const WOOD_PART = Object.freeze({ stairs: Object.freeze({ planks: 6, makes: 4 }), slab: Object.freeze({ planks: 3, makes: 6 }), trapdoor: Object.freeze({ planks: 6, makes: 2 }) })
const WOOD_PART_RE = new RegExp(`^(${WOODS.join('|')})_(stairs|slab|trapdoor)$`)
/**
 * THE WOOD PARTS THE VISIT MUST MAKE -> { crafts: [{ item, count }], planks: { 'spruce_planks': n } } | null. Pure. `want` the visit's
 * needs { name: n }; `have(name)` what the bag (above its keeps) and the town can give of a name. For every wood stairs / slab /
 * trapdoor the needs name beyond what is had: the crafts (rounded up to whole recipes) and the planks of that species they eat. The
 * planks are the caller's to draw (planksFromLogs's way: the species' logs from town).
 */
export function woodPartsPlan (want = {}, { have = () => 0 } = {}) {
  const crafts = [], planks = {}
  for (const [name, n] of Object.entries(want ?? {})) {
    const m = WOOD_PART_RE.exec(name)
    if (!m) continue
    const short = (Number(n) || 0) - Math.max(0, Number(have(name)) || 0)
    if (short <= 0) continue
    const part = WOOD_PART[m[2]]
    const times = Math.ceil(short / part.makes)
    crafts.push({ item: name, count: times * part.makes })
    planks[`${m[1]}_planks`] = (planks[`${m[1]}_planks`] ?? 0) + times * part.planks
  }
  return crafts.length ? { crafts, planks } : null
}

/**
 * A LOW-PITCH (1:2) GABLE ROOF OF SLABS over a wall box -> cells. Pure. For the WIDE buildings (the halls, 11-13 across), where a
 * 45-degree roof's ridge would stand out of a builder's reach from the floor: each course rises HALF a block. Course d (0 at the eave):
 * the overhang a TOP slab beside the wall's top course; then, from the wall line in, a bottom slab, a top slab in the same height one
 * in, a bottom slab a block up ... (every shared face closed: one half each). The middle course is a row of full blocks (`ridge`). On
 * the END WALL lines a top slab would leave a half-block notch in the gable, so it is a full gable block there; the gable ends are
 * filled under the roof like gableRoof's. An 11-wide span (walls 2 high) peaks at y 5 -- in reach from the floor. Not used by the
 * cottage (the halls' piece).
 */
export function slabRoof ({ u0, u1, v0, v1 }, yTop, { ridge = 'u', over = 1, slabRole = 'roofslab', ridgeRole = 'ridgebeam', gableRole = 'gable' } = {}) {
  const cells = []
  const s0 = (ridge === 'u' ? v0 : u0) - over, s1 = (ridge === 'u' ? v1 : u1) + over
  const r0 = (ridge === 'u' ? u0 : v0) - over, r1 = (ridge === 'u' ? u1 : v1) + over
  const mid = (s0 + s1) / 2
  const ends = ridge === 'u' ? [u0, u1] : [v0, v1]
  const put = (s, r, y, role, seg, st) => { const c = ridge === 'u' ? { u: r, v: s } : { u: s, v: r }; cells.push({ ...c, y, role, seg, ...(st ? { st } : {}) }) }
  const at = s => {
    const d = Math.min(s - s0, s1 - s)
    if (d < over) return { y: yTop, half: 'top' }
    const k = d - over
    return { y: yTop + 1 + Math.floor(k / 2), half: k % 2 ? 'top' : 'bottom' }
  }
  for (let s = s0; s <= s1; s++) {
    const { y, half } = at(s)
    const seg = y <= yTop + 1 ? 'roof-edge' : 'roof-inner'
    for (let r = r0; r <= r1; r++) {
      if (Math.abs(s - mid) < 1) put(s, r, y, ridgeRole, 'roof-inner')
      else if (half === 'top' && ends.includes(r) && y > yTop) put(s, r, y, gableRole, seg)
      else put(s, r, y, slabRole, seg, { type: half })
    }
  }
  const sIn0 = ridge === 'u' ? v0 : u0, sIn1 = ridge === 'u' ? v1 : u1
  for (const r of ends) for (let s = sIn0; s <= sIn1; s++) { const { y } = at(s); for (let yy = yTop + 1; yy < y; yy++) put(s, r, yy, gableRole, 'gable') }
  return cells
}
/**
 * ONE PART CRAFT, CUT TO WHAT THE BAG CAN MAKE -> { item, count } | null. Pure. `held(name)` the bag's count. A stairs / slab / trapdoor
 * craft is cut to whole recipes of the planks of its species in the bag; any other craft (the planks from logs) passes unchanged.
 */
export function woodPartCraftable (pc, held = () => 0) {
  const m = WOOD_PART_RE.exec(String(pc?.item ?? ''))
  if (!m) return pc ?? null
  const part = WOOD_PART[m[2]]
  const times = Math.min(Math.ceil((Number(pc.count) || 0) / part.makes), Math.floor((Number(held(`${m[1]}_planks`)) || 0) / part.planks))
  return times > 0 ? { item: pc.item, count: times * part.makes } : null
}

// ---- 4. RESTYLED GENERATIONS OF THE STANDING BLUEPRINTS (townstyle-02) ---------------------------------------------------------
/**
 * A FLAT-ROOFED BLUEPRINT RE-ROOFED -> a new blueprint object (`id`). Pure. Everything at y <= yTop - 1 stays exactly as it was (pad,
 * ring, walls, windows, chests, stations, lights, the doorway); at yTop the WALL LINE's course stays (the eaves become the walls' top
 * course) and the old flat roof's inner cells go; above it a pitched roof over the wall box:
 *   form 'gable'  gableRoof: 45-degree stairs, a slab ridge (spans up to 7 inside the walls: the workshop, the cottage)
 *   form 'slab'   slabRoof: the 1:2 slab roof (the halls: their 11-13 spans stay in reach from the floor)
 * the ridge along the LONGER side; one block of overhang; the gable ends filled; every cell from yTop up `blind` (reach-only: the
 * cottage's rule, Paper 147/147). Segments: the old ones up to the walls, then gable -> roof-edge -> roof-inner, then the old fit-out
 * and any old segment that depended on the roof (copper-lintel) after roof-inner. The wall box is read from the cells (`wallRoles`).
 */
export const WALL_ROLES = Object.freeze(['wall', 'window', 'course', 'corner', 'copper', 'post'])
export const ROOF_ROLES_OLD = Object.freeze(['roof', 'trim', 'eave'])
export function restyleRoof (bp, { id, form = 'slab', yTop = 3, over = 1, ridge = null, wallRoles = WALL_ROLES, keepFlat = false } = {}) {
  const walls = bp.cells.filter(c => c.y === yTop - 1 && wallRoles.includes(c.role))
  const box = { u0: Math.min(...walls.map(c => c.u)), u1: Math.max(...walls.map(c => c.u)), v0: Math.min(...walls.map(c => c.v)), v1: Math.max(...walls.map(c => c.v)) }
  const onLine = c => c.u === box.u0 || c.u === box.u1 || c.v === box.v0 || c.v === box.v1
  // townstyle-03 (`keepFlat`, THE RETROFIT): every old cell stays where and what it is -- the flat roof becomes the CEILING under the new
  // roof (nothing dug, nothing the contents or the doors depend on changes); its segments are renamed `ceiling` (complete in the world)
  const keep = keepFlat ? bp.cells : bp.cells.filter(c => c.y < yTop || (c.y === yTop && onLine(c) && c.u >= box.u0 && c.u <= box.u1 && c.v >= box.v0 && c.v <= box.v1))
  // the wall line's top course keeps its role (eave / copper / trim) but joins its wall's segment (the old roof-edge goes away)
  const sideSeg = c => (c.v === box.v0 ? 'wall-F' : c.v === box.v1 ? 'wall-B' : c.u === box.u0 ? 'wall-L' : 'wall-R')
  const kept = keep.map(c => (['roof-edge', 'roof-inner'].includes(c.seg) && (keepFlat || c.y === yTop) ? { ...c, seg: keepFlat ? 'ceiling' : sideSeg(c) } : { ...c }))
  const r = ridge ?? ((box.u1 - box.u0) >= (box.v1 - box.v0) ? 'u' : 'v')
  // the new roof's roles never reuse an old one (`roof` is the flat roof's planks in every @1 blueprint: a retrofit keeps those cells)
  const roof = (form === 'gable' ? gableRoof(box, yTop, { ridge: r, over, stairRole: 'roofstair' }) : slabRoof(box, yTop, { ridge: r, over }))
    .filter(c => !kept.some(k => k.u === c.u && k.v === c.v && k.y === c.y))
  const cells = [...kept, ...roof]
  for (const c of keepFlat ? roof : cells) if (c.y >= yTop) c.blind = true
  const segNames = new Set(cells.map(c => c.seg))
  const oldSegs = bp.segments.filter(s => segNames.has(s.seg) && !['roof-edge', 'roof-inner'].includes(s.seg))
  const wallSegs = oldSegs.filter(s => /^wall-|^ring$|^pad$|^copper-trim$/.test(s.seg)).map(s => s.seg)
  const after = oldSegs.filter(s => !wallSegs.includes(s.seg))
  const ceiling = keepFlat ? [{ seg: 'ceiling', layer: 4, deps: wallSegs.filter(s => s !== 'pad') }] : []
  const segments = [
    ...oldSegs.filter(s => wallSegs.includes(s.seg)),
    ...ceiling,
    { seg: 'gable', layer: 5, deps: keepFlat ? ['ceiling'] : wallSegs.filter(s => s !== 'pad') },
    { seg: 'roof-edge', layer: 6, deps: ['gable'] },
    { seg: 'roof-inner', layer: 7, deps: ['roof-edge'] },
    ...after.map(s => ({ ...s, deps: [...new Set([...(s.deps ?? []).filter(d => !['roof-edge'].includes(d)), 'roof-inner'])] })),
  ].filter(s => s.seg !== 'gable' || cells.some(c => c.seg === 'gable'))
  const palette = {
    ...bp.palette,
    roofstair: ['%roof_stairs'], ridge: ['%roof_slab'], roofslab: ['%roof_slab'], ridgebeam: ['%roof_planks', '$planks'], gable: ['%wood_planks', '$planks'],
  }
  return { ...bp, id, cells, segments, palette, structural: [...new Set([...(bp.structural ?? []), 'roofstair', 'ridge', 'roofslab', 'ridgebeam', 'gable'])],
    note: `townstyle-02: ${bp.id} re-roofed (${form}, ridge along ${r}) by bots/scripts/make-townstyle.mjs (townstyle.mjs restyleRoof); do not edit by hand` }
}

/**
 * THE TOWN HALL (townstyle-02; owner 11-04 order: the workshop, a new town/meeting hall, then houses; on the wall extension's second
 * hall-size plot X2, 13 x 19) -> the blueprint object. Pure. An 11 x 17 pad (with its stand ring, the plot), the hall 9 x 14 inside:
 * a stone-brick course, log posts at the corners and every few blocks along the long walls (timber framing), plank walls 3 high,
 * glass windows with trapdoor sills, a 3-wide open doorway in the FRONT GABLE END under a round attic window, a PORCH (two log posts,
 * a slab canopy) and torches either side of the door, rows of stair PEWS facing the back wall either side of a central aisle, torches
 * inside; a 1:2 slab roof along the long axis (the 11-wide span peaks at y 6: in reach from the floor), one block of eaves all round.
 */
export const TOWNHALL = Object.freeze({ W: 11, D: 17, wall: { u0: 1, u1: 9, v0: 2, v1: 15 }, yTop: 3, door: [4, 5, 6] })
export function townhallBlueprint () {
  const { W, D, wall: B, yTop, door } = TOWNHALL
  const cells = []
  const add = (u, v, y, role, seg, st) => cells.push({ u, v, y, role, seg, ...(st ? { st } : {}) })
  for (let u = 0; u < W; u++) for (let v = 0; v < D; v++) add(u, v, 0, 'base', 'pad')
  const side = (u, v) => (v === B.v0 ? 'F' : v === B.v1 ? 'B' : u === B.u0 ? 'L' : 'R')
  const postAt = (u, v) => ((u === B.u0 || u === B.u1) && [B.v0, 6, 11, B.v1].includes(v)) || ((v === B.v0 || v === B.v1) && [B.u0, B.u1, 3, 7].includes(u))
  const winAt = (u, v) => ((u === B.u0 || u === B.u1) && [4, 8, 9, 13].includes(v)) || (v === B.v1 && [5].includes(u)) || (v === B.v0 && [2, 8].includes(u))
  const isDoor = (u, v, y) => v === B.v0 && door.includes(u) && y <= 2
  const perim = []
  for (let u = B.u0; u <= B.u1; u++) for (let v = B.v0; v <= B.v1; v++) if (u === B.u0 || u === B.u1 || v === B.v0 || v === B.v1) perim.push([u, v])
  const sills = []
  for (const [u, v] of perim) {
    const seg = `wall-${side(u, v)}`
    for (let y = 1; y <= yTop; y++) {
      if (isDoor(u, v, y)) continue
      if (postAt(u, v)) { add(u, v, y, 'post', seg, { axis: 'y' }); continue }
      if (y === 1) { add(u, v, y, 'course', seg); continue }
      if (y === 2 && winAt(u, v)) { add(u, v, y, 'window', seg); sills.push([u, v]); continue }
      add(u, v, y, 'wall', seg)
    }
  }
  const roof = slabRoof(B, yTop, { ridge: 'v', over: 1 })
  // the round attic window in the front gable: its middle gable cells
  for (const c of roof) if (c.role === 'gable' && c.v === B.v0 && Math.abs(c.u - 5) <= 0 && c.y <= yTop + 2) c.role = 'gablewin'
  cells.push(...roof.filter(c => !cells.some(k => k.u === c.u && k.v === c.v && k.y === c.y)))
  // THE PORCH: two log posts on the front terrace, a canopy of top slabs at y 3 over the door's approach
  for (const u of [3, 7]) for (let y = 1; y <= yTop; y++) add(u, 0, y, 'post', 'porch', { axis: 'y' })
  for (let u = 3; u <= 7; u++) for (const v of [0, 1]) if (!(v === 0 && (u === 3 || u === 7))) add(u, v, yTop, 'canopy', 'porch', { type: 'top' })
  // FIT-OUT: pews either side of the aisle (stairs facing the front: the seat toward the back wall's lectern side), torches, sills
  for (const v of [7, 9, 11]) for (const u of [2, 3, 7, 8]) add(u, v, 1, 'pew', 'fit-out', { facing: '-v', half: 'bottom' })
  for (const [u, v] of [[2, 3], [8, 3], [2, 14], [8, 14]]) add(u, v, 1, 'light', 'fit-out')
  add(3, 1, 2, 'light', 'fit-out'); add(7, 1, 2, 'light', 'fit-out')
  for (const [u, v] of sills) {
    const out = u === B.u0 ? [-1, 0, '-u'] : u === B.u1 ? [1, 0, '+u'] : v === B.v1 ? [0, 1, '+v'] : [0, -1, '-v']
    add(u + out[0], v + out[1], 1, 'sill', 'fit-out', { facing: out[2], half: 'top', open: false })
  }
  for (const c of cells) if (c.y >= yTop) c.blind = true
  const interior = []
  for (let u = B.u0 + 1; u <= B.u1 - 1; u++) for (let v = B.v0 + 1; v <= B.v1 - 1; v++) for (const y of [1, 2]) if (!cells.some(c => c.u === u && c.v === v && c.y === y)) interior.push([u, v, y])
  for (const u of door) interior.push([u, B.v0, 1], [u, B.v0, 2])
  return {
    id: 'townhall@1', kind: 'townhall', footprint: { u: W, v: D }, pad: { w: W, d: D },
    front: { u: 5, v: 0, note: 'townstyle-02: the 3-wide open doorway (u 4-6, v 2, y 1-2) under the porch opens toward v < 0' },
    doorway: door.flatMap(u => [[u, B.v0, 1], [u, B.v0, 2]]),
    interior,
    palette: {
      base: ['%stone', 'cobblestone', 'stone_bricks'], course: ['stone_bricks', 'cobblestone'], post: ['%wood_log'],
      wall: ['%wood_planks', '$planks'], window: windowPalette('$wall'), gable: ['%wood_planks', '$planks'], gablewin: windowPalette('$gable'),
      roofslab: ['%roof_slab'], ridgebeam: ['%roof_planks', '$planks'], canopy: ['%roof_slab'], pew: ['%wood_stairs'], sill: ['%wood_trapdoor'], light: ['torch'],
    },
    segments: [
      { seg: 'pad', layer: 0, deps: [] },
      { seg: 'wall-F', layer: 1, deps: ['pad'] }, { seg: 'wall-B', layer: 1, deps: ['pad'] }, { seg: 'wall-L', layer: 1, deps: ['pad'] }, { seg: 'wall-R', layer: 1, deps: ['pad'] },
      { seg: 'gable', layer: 2, deps: ['wall-F', 'wall-B', 'wall-L', 'wall-R'] },
      { seg: 'roof-edge', layer: 3, deps: ['gable'] },
      { seg: 'roof-inner', layer: 4, deps: ['roof-edge'] },
      { seg: 'porch', layer: 5, deps: ['roof-inner'] },
      { seg: 'fit-out', layer: 6, deps: ['porch'] },
    ],
    structural: ['base', 'course', 'post', 'wall', 'gable', 'roofslab', 'ridgebeam'],
    cells,
    note: 'townstyle-02: generated by bots/scripts/make-townstyle.mjs from bots/src/townstyle.mjs townhallBlueprint(); do not edit by hand',
  }
}
