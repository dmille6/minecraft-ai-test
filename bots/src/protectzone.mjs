// PROTECTED ZONES (protectzone-01; docs/reports/protectzone-01-design-2026-10-20.md). Scenery the bots never change or use.
//
// WHY. OWNER DECISION 2026-10-20 ~15:30Z ("option 1"): the showcase world's naturally generated taiga village is kept as
// scenery -- no bot digs, takes apart, builds in, opens, sleeps in or crafts at anything in it. The fleet had no
// data-driven protection a world could declare: townzone-01 is a fixed square around home, structureguard-01 (not kept)
// reads only the monument's record. So one per-world FILE names boxes, and one guard enforces them.
//
// THE FILE: `<poolStateDir(MEMORY_POOL)>/protected-zones.json` (the town's own directory: one pool = one world). No file ->
// every zone off and EVERY wrapper below passes straight through (the bench has no file: behaviour identical).
//   { "version": 1, "world": "showcase", "hashed_seed": "<the login packet's hashedSeed>",
//     "zones": [ { "id": "village-taiga-6_1", "kind": "village", "label": "the taiga village",
//                  "box": [x0, y0, z0, x1, y1, z1] } ] }        // inclusive, integers
//   hashed_seed binds the file to ONE world: a file whose seed is not this bot's world's is ignored (and said so).
//   A VILLAGE'S BOX RUNS FROM THE WORLD'S BOTTOM (y0 -64; infra/showcase/structure_zones.py writes it so; Claude r1 P1): a bot
//   that dug in UNDER the footprint could only come up through the village -- `surface` and every dig-capable path are
//   refused there, and the walk out is 50+ blocks of rock. A whole column keeps every tunnel and stair out from under it.
//   "floor_y" (optional, the lowest village block minus the pad) marks the DEEP part of the column (Claude r2 P2): a bot that
//   is ALREADY under the floor -- it walked or dropped into a cave pocket there -- may dig and place below the floor to get
//   out sideways; nobody outside may dig in (blocked() below). The village above the floor stays refused to everyone.
//
// WHAT IS GUARDED, and where (every path that can change or consume a block or a container goes through one of these):
//   CHOKEPOINT (attachProtectZone): bot.dig, bot._genericPlace (placeBlock, _placeBlockWithOptions and placeEntity all
//     call it), bot.activateBlock, bot.openBlock (openContainer/openChest/openFurnace call it), bot.sleep, bot.craft with a
//     table. A refused call returns a REJECTED PROMISE (every caller, the pathfinder's included, already handles one) whose
//     error names the zone and the remedy. A placement is judged on its reference, its destination and the cell above it.
//   ENUMERATION (the same attach): bot.findBlocks (bot.findBlock calls it) never returns a cell inside a zone, so gather's
//     candidates, the crafting-table / furnace / chest / bed finders, the prompt's and the survey's resource lists never
//     offer one -- the chokepoint is the backstop, not the planner.
//   PATHFINDER (zoneCost): exclusionAreasBreak and exclusionAreasPlace answer 100 in a zone (mineflayer-pathfinder 2.4.5:
//     safeToBreak needs < 100; a move costing > 100 is dropped), so no path digs or scaffolds there. Walking is untouched:
//     the village's paths stay walkable, and a bot inside a zone always has its open surface to walk out over.
//   MINE (zoneKeepOut, skills.mjs): one more part of minewell's composed keep-out: no stair through a zone, a walk-off to
//     just beyond its side (zoneExitColumns), a per-dig stop.
//
// ZONEGUARD-01SHOW (11-09, showcase-Haven 01:42Z: a `mine` stair at y 18 under village-taiga-6_1 dug 57,18,5 oak_planks -- a
// mineshaft plank in the tripwire's baseline -- and the pathfinder's pillar put cobblestone in the hole; S4 BREACH, the showcase
// stopped and rolled back). THE TWO SIDES READ DIFFERENT VOLUMES: the tripwire's S4 compares EVERY baseline structure cell of a
// box from y0 (-64) to y1, while blocked() below opened every cell under floor_y (54) to a bot whose feet were also under it
// (the deep exemption), and a survival purpose passed every cell at any depth. THE FIX READS THE TRIPWIRE'S OWN FILE: the
// baseline (`showcase_trip.py zones-baseline`, BASELINE_FILE) names every cell S4 compares; each zone carries those cells
// (structGuardOf) and NO bot dig or placement may change one, at any depth, whatever its purpose (structAt, checked BEFORE the
// deep exemption and before the survival pass). What a dig or placement changes besides its own cell is guarded with it: the
// support of a block that hangs or stands on another (a wall_torch, a door, a carpet: S_SUPPORT, digs only) and the cell over a
// dirt_path (a block placed on a path turns it to dirt: S_COVER, placements only). A placement's REFERENCE changes nothing and is
// judged by the old rule only (a pillar on a mineshaft floor stays a pillar). Ordinary rock beside a structure stays open to a
// deep bot, so the way out (zonewalk.mjs: a tunnel through ordinary rock to a side) is the one it always had.
// A zone with NO baseline (the fleet: no S4 runs there) gets the same rule by NAME for non-survival digs below its floor
// (deepNameBlocked: escapeguard's survival rule, a block that is neither ordinary terrain nor natural cave stuff). ZONEGUARD=off
// restores the base everywhere.
//
// SURVIVAL KEEPS PRIORITY (as townzone-01): a dig, placement or block use whose purpose is `survival` (digtown.mjs
// digPurpose: a reflex holding the body, or the reflex tick's scope) is never refused -- a drowning or entombed bot gets
// air first and the scenery absorbs that damage. Opening a container, sleeping and crafting are never survival.
import fs from 'node:fs'
import path from 'node:path'
import { Vec3 } from 'vec3'
import { digPurpose, currentDigScope } from './digtown.mjs'

export const ZONES_FILE = 'protected-zones.json'
export const ZONES_VERSION = 1
/** The file is re-read this often by the caller's timer (an install or an edit is honoured without a restart). */
export const RELOAD_MS = 30_000
export const MAX_ZONES = 64
/** A box wider than this horizontally, or taller than the world, is refused as a typo: one bad digit must not freeze a world. */
export const MAX_SPAN = 1024
/** How far beyond a zone's side a walk-out point sits. */
export const EXIT_PAD = 4   // > goto's arrival range 2 (Paper 10-20: a GoalNear 3 past stopped ON the edge cell), so the walk ends outside
/** pathfinder: >= 100 is "never" for a break (safeToBreak) and a dropped move for a place. */
export const ZONE_COST = 100

// ---------------------------------------------------------------------------------------------- zoneguard-01show
/** ZONEGUARD=off (0/false/no) is the kill switch: no baseline is read, no name rule runs -- the base's behaviour exactly. */
export const zoneGuardOn = (env = typeof process !== 'undefined' ? process.env : {}) =>
  !/^(off|0|false|no)$/i.test(String(env?.ZONEGUARD ?? 'on').trim())
/** The tripwire's baseline (infra/showcase/showcase_trip.py zones-baseline --out): looked for beside the zones file, then where
 *  the showcase's tripwire keeps it. PROTECT_ZONES_BASELINE=<path> names it; =off reads none. */
export const BASELINE_FILE = 'zones-baseline.json'
export const SHOWCASE_BASELINE = '/srv/showcase/trip/zones-baseline.json'
/** The flags of a guarded cell. A dig is refused on S_CELL | S_SUPPORT, a placement's destination on S_CELL | S_COVER. */
export const S_CELL = 1, S_SUPPORT = 2, S_COVER = 4
export const DIG_MASK = S_CELL | S_SUPPORT
export const PLACE_MASK = S_CELL | S_COVER
export const ANY_MASK = S_CELL | S_SUPPORT | S_COVER
/** Palette blocks that drop when a neighbour is dug (they hang on, stand on or lean on it), or fall (anvil, scaffolding). */
export const SUPPORTED = /(torch|lantern|_door|sign|pressure_plate|button|carpet|bell|ladder|chain|_bed|scaffolding|anvil|rail|flower_pot|candle|banner|lever)$|^potted_/
/** Palette blocks a placement ABOVE changes (a full block on a dirt_path turns it to dirt). */
export const COVERED = /^(dirt_path|farmland)$/
/** The bound on one zone's guarded cells (the showcase's largest, the trial chambers, is 69,712). */
export const MAX_GUARD_CELLS = 400_000
/** ORDINARY TERRAIN (moved here from escapeguard.mjs, which re-exports it): never a structure's block. */
export const ORDINARY_TERRAIN = /^(stone|deepslate|granite|diorite|andesite|tuff|calcite|dripstone_block|smooth_basalt|basalt|dirt|coarse_dirt|rooted_dirt|grass_block|podzol|mycelium|mud|clay|gravel|sand|red_sand|sandstone|red_sandstone|snow_block|snow|ice|packed_ice|moss_block|netherrack|soul_sand|soul_soil|end_stone|(deepslate_)?(coal|iron|copper|gold|redstone|lapis|diamond|emerald)_ore|nether_(gold|quartz)_ore)$/
/** BELOW a zone's floor: natural cave blocks and the bots' own pillar blocks (moved here from escapeguard.mjs, re-exported). */
export const DEEP_NATURAL_BLOCKS = /^(cobblestone|cobbled_deepslate|sculk|sculk_vein|sculk_catalyst|sculk_sensor|sculk_shrieker|pointed_dripstone|amethyst_block|budding_amethyst|(small|medium|large)_amethyst_bud|amethyst_cluster|obsidian|crying_obsidian|magma_block|glow_lichen|moss_carpet|hanging_roots|cave_vines|cave_vines_plant|spore_blossom|azalea|flowering_azalea|big_dripleaf|big_dripleaf_stem|small_dripleaf|glow_berries|short_grass|tall_grass|fern|large_fern|dead_bush|vine|seagrass|tall_seagrass|kelp|kelp_plant)$/
const bare = n => (typeof n === 'string' ? n.replace(/^minecraft:/, '') : '')

/**
 * THE TRIPWIRE'S BASELINE -> { zones: Map(id -> { box, cells: { "x,y,z": name } }), why }. Pure. A zone the baseline could not
 * read (NOT COVERED, no `cells`) is absent: the zone keeps the name rule (deepNameBlocked), as on the fleet.
 */
export function parseBaseline (raw) {
  if (raw == null) return { zones: new Map(), why: 'absent' }
  if (typeof raw !== 'object' || Array.isArray(raw) || typeof raw.zones !== 'object' || raw.zones == null) return { zones: new Map(), why: 'not_a_baseline' }
  const out = new Map()
  for (const [id, b] of Object.entries(raw.zones)) {
    if (!b || typeof b !== 'object' || !b.cells || typeof b.cells !== 'object') continue
    const box = Array.isArray(b.box) && b.box.length === 6 && b.box.every(isInt) ? b.box : null
    // THE GUARD IS BUILT HERE, ONCE PER READ (Claude r1 note 2): the parsed cell objects (tens of MB in 14 bots) are dropped
    // after this; a zones-file change re-joins the prebuilt guards
    out.set(id, { box, guard: structGuardOf(b.cells) })
  }
  return { zones: out, why: out.size ? 'ok' : 'empty' }
}

/**
 * ONE ZONE'S GUARDED CELLS -> { x0, y0, z0, x1, y1, z1, sy, sz, map: Map(key -> flags), n } | null. Pure. `cells` the baseline's
 * { "x,y,z": "minecraft:name" }. Every cell is S_CELL; the six neighbours of a SUPPORTED block are S_SUPPORT; the cell over a
 * COVERED block is S_COVER. The key is relative to the guard's own bounding box (numbers, no allocation in the A* step).
 */
export function structGuardOf (cells) {
  if (!cells || typeof cells !== 'object') return null
  const list = []
  for (const [k, name] of Object.entries(cells)) {
    const p = k.split(',').map(Number)
    if (p.length !== 3 || !p.every(isInt)) continue
    list.push([p[0], p[1], p[2], S_CELL])
    const n = bare(name)
    if (SUPPORTED.test(n)) for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) list.push([p[0] + dx, p[1] + dy, p[2] + dz, S_SUPPORT])
    if (COVERED.test(n)) list.push([p[0], p[1] + 1, p[2], S_COVER])
    if (list.length > MAX_GUARD_CELLS * 2) return null
  }
  if (!list.length) return null
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity
  for (const [x, y, z] of list) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z }
  const sy = y1 - y0 + 1, sz = z1 - z0 + 1
  const map = new Map(), colMin = new Map()
  let n = 0
  for (const [x, y, z, f] of list) {
    const key = ((x - x0) * sy + (y - y0)) * sz + (z - z0)
    const was = map.get(key) ?? 0
    if (f === S_CELL && !(was & S_CELL)) n++
    map.set(key, was | f)
    // the lowest baseline cell of each column (liquidReaches)
    if (f === S_CELL) { const ck = (x - x0) * sz + (z - z0), m = colMin.get(ck); if (m == null || y < m) colMin.set(ck, y) }
  }
  return { x0, y0, z0, x1, y1, z1, sy, sz, map, colMin, n }
}

/** One guard's flags at an integer cell (0: not guarded). Pure, allocation-free. */
export function structFlagsIn (g, cx, cy, cz) {
  if (!g || cx < g.x0 || cx > g.x1 || cy < g.y0 || cy > g.y1 || cz < g.z0 || cz > g.z1) return 0
  return g.map.get(((cx - g.x0) * g.sy + (cy - g.y0)) * g.sz + (cz - g.z0)) ?? 0
}

/**
 * IS THIS CELL ONE THE TRIPWIRE'S S4 COMPARES (or one whose dig/placement changes one)? -> zone | null. Pure, allocation-free.
 * No depth, no feet, no purpose: the baseline's cells are closed to every bot. `mask` DIG_MASK for a dig, PLACE_MASK for a
 * placement's destination, S_CELL for the cell above it, ANY_MASK for a planner that does not know which.
 */
export function structAt (zones, x, y, z, mask = DIG_MASK) {
  if (!zones || !zones.length) return null
  const cx = Math.floor(x), cy = Math.floor(y), cz = Math.floor(z)
  if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(cz)) return null
  for (let i = 0; i < zones.length; i++) { const g = zones[i].guard; if (g && (structFlagsIn(g, cx, cy, cz) & mask)) return zones[i] }
  return null
}

/** A structure block by NAME: solid, not ordinary terrain, not natural cave stuff or a bot's pillar block. Pure. */
export const deepStructureName = name => {
  const n = bare(name)
  return !!n && !/(^|_)air$/.test(n) && !/^(water|lava|bubble_column)$/.test(n) && !ORDINARY_TERRAIN.test(n) && !DEEP_NATURAL_BLOCKS.test(n)
}

/**
 * THE NAME RULE for a zone WITHOUT a baseline -> zone | null. Pure. A cell the deep exemption opens (below floor_y, the bot's
 * feet under it too) holding a structure block by name is closed to a non-survival dig. A zone with a baseline never answers
 * here (its cells are exact); a cell the base rule already closes is the base's.
 */
export function deepNameBlocked (zones, x, y, z, name, feet = null, { on = true } = {}) {
  if (!on || !zones || !zones.length) return null
  const cx = Math.floor(x), cy = Math.floor(y), cz = Math.floor(z)
  for (const q of zones) {
    if (q.guard || q.floorY == null || cy >= q.floorY) continue
    // the box first, the name's regexes only for a cell inside one (Claude r1 note 5: the A* step)
    if (cx >= q.x0 && cx <= q.x1 && cy >= q.y0 && cy <= q.y1 && cz >= q.z0 && cz <= q.z1) return deepStructureName(name) ? q : null
  }
  return null
}

/** One fall renews a liquid's horizontal run (water 7; lava 3 in the overworld, taken as 7): the prefilter's bound per level. */
export const LIQUID_SPREAD = 7
/** The flow search's bound: past it the pour is refused (a flow nobody traced is not a safe flow). */
export const LIQUID_MAX_NODES = 4000

/**
 * COULD A LIQUID POURED HERE REACH A BASELINE CELL AT ALL? -> zone | null. Pure, the cheap prefilter (Codex r1 blocker 2, r2: a
 * fixed radius does not bound DOWNHILL flow -- every drop renews the run). A baseline column whose lowest cell is no higher
 * than one above the pour, within (LIQUID_SPREAD + 1) per level of drop horizontally, is a candidate; liquidFlowReaches decides.
 */
export function liquidReaches (zones, p) {
  if (!zones || !zones.length || !p) return null
  const px = Math.floor(p.x), py = Math.floor(p.y), pz = Math.floor(p.z)
  if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) return null
  for (const q of zones) {
    const g = q.guard
    if (!g || !g.colMin || g.y0 > py + 1) continue
    for (const [ck, m] of g.colMin) {
      if (m > py + 1) continue
      const x = g.x0 + Math.floor(ck / g.sz), z = g.z0 + (ck % g.sz)
      if (Math.max(Math.abs(x - px), Math.abs(z - pz)) <= (LIQUID_SPREAD + 1) * (py - m + 2)) return q
    }
  }
  return null
}

/**
 * WOULD THE FLOW FROM THESE CELLS REACH A BASELINE CELL? -> zone | null. A bounded trace of how a liquid runs (Codex r2): from
 * each seed through open cells (no collision box: air, water, plants, torches): down whenever it can (the run renews; a cell it
 * can fall from it does not leave sideways), else sideways LIQUID_SPREAD cells per level. A baseline cell the flow enters is reached (water washes a torch away); for LAVA a baseline cell
 * beside or two above the flow is reached too (it sets planks and logs alight). An unread cell, or a trace past maxNodes, is
 * answered as reached: refused, never guessed. `at(x, y, z)` -> block | null. Only when the prefilter names a zone.
 */
export function liquidFlowReaches (zones, seeds, at, { lava = false, maxNodes = LIQUID_MAX_NODES, budget = null } = {}) {
  const pre = (seeds ?? []).map(c => liquidReaches(zones, { x: c[0], y: c[1], z: c[2] })).find(Boolean)
  if (!pre) return null
  if (typeof at !== 'function') return pre
  const open = (x, y, z) => { const b = at(x, y, z); return b == null ? null : b.boundingBox !== 'block' }
  const hit = (x, y, z) => structAt(zones, x, y, z, S_CELL)
  const best = new Map(), queue = []
  for (const c of seeds) { const o = open(c[0], c[1], c[2]); if (o == null) return pre; if (o) queue.push([c[0], c[1], c[2], LIQUID_SPREAD]) }
  let n = 0
  while (queue.length) {
    const [x, y, z, sp] = queue.pop()
    const k = `${x},${y},${z}`
    if ((best.get(k) ?? -1) >= sp) continue
    best.set(k, sp)
    if (++n > maxNodes) return pre
    // A CALLER'S SHARED BUDGET (Claude r3: a planner asking per candidate cell must not block the event loop): spent -> refused
    if (budget && --budget.left < 0) return pre
    const h = hit(x, y, z)
    if (h) return h
    if (lava) {
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, 2, 0], [0, -1, 0]]) { const l = hit(x + dx, y + dy, z + dz); if (l) return l }
    }
    if (y <= -64) continue
    const below = at(x, y - 1, z)
    if (below == null) return pre
    const d = below.boundingBox !== 'block'
    // A LIQUID THAT CAN FALL, FALLS (the game's own rule: it runs sideways only over something it cannot enter); the fall
    // renews its run. Only AIR or a liquid below is a sure fall (Codex r3: a sign, a door, a torch has no collision box but a
    // liquid may not enter it) -- over anything else without a collision box the trace takes BOTH ways, down and sideways.
    if (d) queue.push([x, y - 1, z, LIQUID_SPREAD])
    if (d && /^(air|cave_air|void_air|water|lava|bubble_column)$/.test(bare(below.name))) continue
    if (sp > 0) {
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const o = open(x + dx, y, z + dz)
        if (o == null) return pre
        if (o) queue.push([x + dx, y, z + dz, sp - 1])
      }
    }
  }
  return null
}

/**
 * THE ZONES WITH THEIR BASELINE CELLS -> { zones (new objects; the input is not touched), state }. Pure. A baseline zone joins
 * the zones-file zone of the SAME id whose box meets its own (a baseline from another world never protects this one); one with
 * no such zone is named in `orphan`, a zones-file zone with none in `missing`.
 */
export function withBaseline (zones, base) {
  const st = { why: base?.why ?? 'absent', guarded: [], missing: [], orphan: [], cells: 0, bad: [] }
  if (!base || !base.zones || !base.zones.size) return { zones, state: st }
  const meets = (q, b) => !b || (b[0] <= q.x1 && b[3] >= q.x0 && b[1] <= q.y1 && b[4] >= q.y0 && b[2] <= q.z1 && b[5] >= q.z0)
  const ids = new Set(zones.map(q => q.id))
  for (const id of base.zones.keys()) if (!ids.has(id)) st.orphan.push(id)
  const out = zones.map(q => {
    const b = base.zones.get(q.id)
    if (!b) { st.missing.push(q.id); return q }
    if (!meets(q, b.box)) { st.bad.push(`${q.id}:box_apart`); return q }
    const g = b.guard ?? structGuardOf(b.cells)
    if (!g) { st.bad.push(`${q.id}:cells`); return q }
    st.guarded.push(q.id); st.cells += g.n
    return { ...q, guard: g }
  })
  return { zones: out, state: st }
}

const isInt = v => Number.isInteger(v)

/**
 * THE FILE -> { zones, why, bad }. Pure. `raw` is the parsed JSON (or null: no file). A zone is
 * { id, kind, label, x0, y0, z0, x1, y1, z1 } (inclusive integers, x0 <= x1 ...). An invalid zone is dropped and NAMED in
 * `bad` (the valid ones still protect); a file for another world (hashed_seed differs from `worldId`) protects nothing.
 * `worldId` unknown ('' / null): the file is honoured -- it sits in this pool's own directory.
 */
export function parseZones (raw, { worldId = null } = {}) {
  if (raw == null) return { zones: [], why: 'absent', bad: [] }
  if (typeof raw !== 'object' || Array.isArray(raw)) return { zones: [], why: 'not_an_object', bad: [] }
  if (raw.version !== ZONES_VERSION) return { zones: [], why: `bad_version:${raw.version}`, bad: [] }
  const seed = raw.hashed_seed
  if (seed != null && worldId != null && worldId !== '' && String(seed) !== String(worldId)) return { zones: [], why: 'world_mismatch', bad: [] }
  if (!Array.isArray(raw.zones)) return { zones: [], why: 'no_zones', bad: [] }
  const zones = [], bad = []
  for (const [i, z] of raw.zones.slice(0, MAX_ZONES).entries()) {
    const b = z?.box
    const id = typeof z?.id === 'string' && z.id ? z.id.slice(0, 64) : null
    if (!id || !Array.isArray(b) || b.length !== 6 || !b.every(isInt)) { bad.push(`${i}:shape`); continue }
    const [x0, y0, z0, x1, y1, z1] = b
    if (x0 > x1 || y0 > y1 || z0 > z1) { bad.push(`${id}:order`); continue }
    if (x1 - x0 > MAX_SPAN || z1 - z0 > MAX_SPAN || y1 - y0 > 448) { bad.push(`${id}:span`); continue }
    const kind = typeof z.kind === 'string' && /^[a-z_]{1,24}$/.test(z.kind) ? z.kind : 'scenery'
    const label = typeof z.label === 'string' && z.label ? z.label.slice(0, 60) : `the protected ${kind}`
    let floorY = null
    if (z.floor_y != null) {
      if (!isInt(z.floor_y) || z.floor_y < y0 || z.floor_y > y1) { bad.push(`${id}:floor_y`); continue }
      floorY = z.floor_y
    }
    zones.push({ id, kind, label, x0, y0, z0, x1, y1, z1, floorY })
  }
  if (raw.zones.length > MAX_ZONES) bad.push(`over_${MAX_ZONES}`)
  return { zones, why: zones.length ? 'ok' : 'empty', bad }
}

/** The zone holding the cell (integers by floor) -> zone | null. Pure, allocation-free (the A* hot path calls it). */
export function zoneAt (zones, x, y, z) {
  if (!zones || !zones.length) return null
  const fx = Math.floor(x), fy = Math.floor(y), fz = Math.floor(z)
  if (!Number.isFinite(fx) || !Number.isFinite(fy) || !Number.isFinite(fz)) return null
  for (let i = 0; i < zones.length; i++) {
    const q = zones[i]
    if (fx >= q.x0 && fx <= q.x1 && fy >= q.y0 && fy <= q.y1 && fz >= q.z0 && fz <= q.z1) return q
  }
  return null
}
export const zoneAtPos = (zones, p) => (p ? zoneAt(zones, p.x, p.y, p.z) : null)

/**
 * IS THIS CELL CLOSED TO THIS BOT? -> zone | null. Pure, allocation-free. zoneAt, except the DEEP exemption (Claude r2 P2): a
 * cell below its zone's floor_y is open to a bot whose FEET are also below that floor inside the same column -- a bot in a
 * cave pocket under a village digs its way out sideways; a bot outside can never tunnel in, and the village (at or above
 * floor_y) is closed to everyone. `feet` null: no exemption.
 */
export function blocked (zones, x, y, z, feet = null, base = false) {
  if (!zones || !zones.length) return null
  const cx = Math.floor(x), cy = Math.floor(y), cz = Math.floor(z)
  if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(cz)) return null
  // EVERY ZONE HOLDING THE CELL (Codex r3 P2): one zone's deep exemption never opens a cell another zone closes
  for (let i = 0; i < zones.length; i++) if (blockedIn(zones[i], cx, cy, cz, feet, base)) return zones[i]
  return null
}

/**
 * One zone's verdict on an integer cell (no allocation: the A* hot path). Pure. ZONEGUARD-01SHOW: a cell the tripwire's baseline
 * guards (any flag: a planner that asks blocked() does not say whether it digs or places) is closed BEFORE the deep exemption,
 * to every bot. `base` true: the old rule only (the chokepoint and placeBlocked ask structAt themselves, with the op's mask).
 */
export function blockedIn (q, cx, cy, cz, feet = null, base = false) {
  if (!base && q.guard && structFlagsIn(q.guard, cx, cy, cz)) return true
  if (!(cx >= q.x0 && cx <= q.x1 && cy >= q.y0 && cy <= q.y1 && cz >= q.z0 && cz <= q.z1)) return false
  if (q.floorY == null || !feet || cy >= q.floorY) return true
  const fx = Math.floor(feet.x), fy = Math.floor(feet.y), fz = Math.floor(feet.z)
  return !(fy < q.floorY && fx >= q.x0 && fx <= q.x1 && fz >= q.z0 && fz <= q.z1)
}

/**
 * MAY A BLOCK BE PLACED AT THIS CELL? -> zone | null. The guard's three cells, as far as a planner that knows only the
 * destination can see them (Claude r2/r3, Codex r3): the destination, the cell above it, and every face neighbour (the
 * reference is one of them). Conservative: a cell touching a closed zone cell is never a scaffold. Allocation-free.
 */
export function placeBlocked (zones, x, y, z, feet = null) {
  // ZONEGUARD-01SHOW: the destination may not be a baseline cell or the cover of a path, the cell above it not a baseline cell
  // (the guard's own three cells); the references keep the old rule (placing AGAINST a structure block changes nothing)
  return structAt(zones, x, y, z, PLACE_MASK) || structAt(zones, x, y + 1, z, S_CELL) ||
         blocked(zones, x, y, z, feet, true) || blocked(zones, x, y + 1, z, feet, true) || blocked(zones, x, y - 1, z, feet, true) ||
         blocked(zones, x + 1, y, z, feet, true) || blocked(zones, x - 1, y, z, feet, true) || blocked(zones, x, y, z + 1, feet, true) || blocked(zones, x, y, z - 1, feet, true) ||
         // the forward bridge places against the bot's floor, DIAGONAL-below the priced cell (Claude r4 P3)
         blocked(zones, x + 1, y - 1, z, feet, true) || blocked(zones, x - 1, y - 1, z, feet, true) || blocked(zones, x, y - 1, z + 1, feet, true) || blocked(zones, x, y - 1, z - 1, feet, true)
}

/** Is the bot's column (any y) inside this zone's footprint, grown by `margin`? Pure. */
export function overFootprint (zone, p, margin = 0) {
  return !!zone && !!p && Math.floor(p.x) >= zone.x0 - margin && Math.floor(p.x) <= zone.x1 + margin &&
         Math.floor(p.z) >= zone.z0 - margin && Math.floor(p.z) <= zone.z1 + margin
}

/** Does any zone's box meet the sphere (point, r)? Pure (the findBlocks pass-through test: a search far away is untouched). */
export function zonesNear (zones, point, r) {
  if (!zones || !zones.length || !point) return false
  const R = Number.isFinite(r) ? r + 1 : Infinity
  return zones.some(q => point.x >= q.x0 - R && point.x <= q.x1 + 1 + R && point.y >= q.y0 - R && point.y <= q.y1 + 1 + R &&
                         point.z >= q.z0 - R && point.z <= q.z1 + 1 + R)
}

/**
 * THE WAY OUT -> { x, z, side } | null: the nearest point EXIT_PAD beyond the footprint's nearest side, at the bot's own
 * coordinate on the other axis. Pure. null when p is not over the footprint (then "outside" is where it already is).
 */
export function exitPoint (zone, p, pad = EXIT_PAD) {
  if (!overFootprint(zone, p)) return null
  const x = Math.floor(p.x), z = Math.floor(p.z)
  const opts = [
    { d: x - zone.x0, x: zone.x0 - pad, z, side: 'west' }, { d: zone.x1 - x, x: zone.x1 + pad, z, side: 'east' },
    { d: z - zone.z0, x, z: zone.z0 - pad, side: 'north' }, { d: zone.z1 - z, x, z: zone.z1 + pad, side: 'south' },
  ].sort((a, b) => a.d - b.d)
  const { d, ...o } = opts[0]
  return o
}

/** Which side of a zone's footprint a point lies beyond -> 'west' | 'east' | 'north' | 'south' | null (over it). Pure. */
export function sideOf (zone, p) {
  if (!zone || !p) return null
  const x = Math.floor(p.x), z = Math.floor(p.z)
  // A CORNER CELL BELONGS TO THE AXIS IT OVERHANGS MORE (Claude r2 P3): a failed corner walk must not rule out a whole side
  const ox = x < zone.x0 ? zone.x0 - x : x > zone.x1 ? x - zone.x1 : 0, oz = z < zone.z0 ? zone.z0 - z : z > zone.z1 ? z - zone.z1 : 0
  if (!ox && !oz) return null
  return ox >= oz ? (x < zone.x0 ? 'west' : 'east') : (z < zone.z0 ? 'north' : 'south')
}

/**
 * A POINT `dist` BEYOND THE ZONE from p -> { x, z, side } | null: over the footprint, past its nearest side; beside it, pushed
 * straight out from the side it lies beyond. Pure (the bucket's remedy: its refusal reaches 6 past the box).
 */
export function awayPoint (zone, p, dist) {
  if (!zone || !p) return null
  if (overFootprint(zone, p)) return exitPoint(zone, p, dist)
  const side = sideOf(zone, p), x = Math.floor(p.x), z = Math.floor(p.z)
  if (side === 'west') return { x: Math.min(x, zone.x0 - dist), z, side }
  if (side === 'east') return { x: Math.max(x, zone.x1 + dist), z, side }
  if (side === 'north') return { x, z: Math.min(z, zone.z0 - dist), side }
  if (side === 'south') return { x, z: Math.max(z, zone.z1 + dist), side }
  return null
}

/** Is any zone's box within `reach` blocks (Chebyshev, any axis) of p? Pure (the bucket: the server's ray, not the target, decides). */
export function zoneWithin (zones, p, reach) {
  if (!zones || !zones.length || !p) return null
  const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z)
  return zones.find(q => x >= q.x0 - reach && x <= q.x1 + reach && y >= q.y0 - reach && y <= q.y1 + reach && z >= q.z0 - reach && z <= q.z1 + reach) ?? null
}

/**
 * The refusal's words: what is protected, and a move the bot can make from where it stands. Pure. `standY(x, z)` (optional)
 * answers a standable height at the exit column (Claude r1 P2: the bot's own y can be solid rock on a hill or in a cave);
 * without an answer the exit is named by its column. A bot already outside the footprint is told to work beyond it.
 */
export function zoneRemedy (zone, op, at, from = null, { standY = null, pad = EXIT_PAD, struct = false } = {}) {
  const where = at ? `${Math.floor(at.x)},${Math.floor(at.y)},${Math.floor(at.z)}` : '?'
  const box = `x ${zone.x0}..${zone.x1}, z ${zone.z0}..${zone.z1}`
  const ex = from ? (pad > EXIT_PAD ? awayPoint(zone, from, pad) : exitPoint(zone, from, pad)) : null
  let ey = null
  if (ex && typeof standY === 'function') { try { ey = standY(ex.x, ex.z) } catch { ey = null } }
  // goto needs a y (gotoLegs: Number(y)): a standable one, else the bot's own as an approximation (Claude r2 P3)
  const fy = from && Number.isFinite(from.y) ? Math.floor(from.y) : null
  const go = ex ? `walk out first (goto ${ex.x} ${ey ?? fy ?? 70} ${ex.z}${ey == null ? ', height approximate' : ''}; ${pad} blocks past its ${ex.side} side) and `
    : from ? `you are beside it: step away from it${sideOf(zone, from) ? ` (its ${sideOf(zone, from)} side)` : ''} and ` : ''
  const what = op === 'open' ? 'open its containers' : op === 'sleep' ? 'sleep in its beds' : op === 'craft' ? 'use its crafting tables'
    : op === 'use' ? 'use its blocks' : op === 'place' ? 'build in it' : 'dig it'
  // ZONEGUARD-01SHOW: a structure cell is closed at every depth, but the ordinary rock around it is not -- the deep bot's way on
  if (struct) {
    return `protected zone: ${zone.label} (${box}) -- cell ${where} is part of the structure itself, closed at every depth and to ` +
           `every purpose (bots never ${what}); dig the ordinary rock (stone, deepslate, dirt) around it instead, or ${go || 'step away and '}` +
           'take blocks or build anywhere outside it'
  }
  return `protected zone: ${zone.label} (${box}) is kept as scenery -- bots never ${what} (cell ${where}); ${go}` +
         `${op === 'open' ? 'use the town\'s chests' : op === 'sleep' ? 'sleep at home' : op === 'craft' ? 'craft at your own table' : 'take blocks or build anywhere outside it'}`
}

export class ProtectedZoneError extends Error {
  constructor (zone, op, at, remedy) {
    super(remedy)
    this.name = 'ProtectedZoneError'
    this.code = 'protected_zone'
    this.zone = zone?.id ?? null
    this.op = op
    this.at = at ? { x: Math.floor(at.x), y: Math.floor(at.y), z: Math.floor(at.z) } : null
  }
}

/** Ops a survival purpose may still perform inside a zone (a reflex's air, pillar or wall). Never open/sleep/craft. */
export const SURVIVAL_OPS = new Set(['dig', 'place', 'use'])

/**
 * THE GUARD'S ONE DECISION -> null (allowed) | { zone }. Pure. `op` in dig | place | use | open | sleep | craft; `cell` the
 * block's cell; `purpose` digPurpose's answer for this call.
 */
export function zoneDecision ({ zones, op, cell, purpose = null, feet = null, role = null, name = null, nameRule = true }) {
  if (!cell) return null
  // ZONEGUARD-01SHOW 1: THE TRIPWIRE'S CELLS, before the deep exemption and before the survival pass -- never changed by a bot
  const mask = structMask(op, role)
  const s = mask ? structAt(zones, cell.x, cell.y, cell.z, mask) : null
  if (s) return { zone: s, struct: true }
  // 2: no baseline for the zone: a deep structure block by name, for a non-survival dig (survival has escapeguard's own rule)
  if (op === 'dig' && purpose !== 'survival') {
    const d = deepNameBlocked(zones, cell.x, cell.y, cell.z, name, feet, { on: nameRule })
    if (d) return { zone: d, struct: true }
  }
  const z = blocked(zones, cell.x, cell.y, cell.z, feet, true)
  if (!z) return null
  if (purpose === 'survival' && SURVIVAL_OPS.has(op)) return null
  return { zone: z }
}

/** The flags an op at a cell must not touch (zoneguard-01show). A placement's reference changes nothing: none. Pure. */
export function structMask (op, role = null) {
  if (op === 'dig') return DIG_MASK
  if (op !== 'place') return 0
  return role === 'ref' ? 0 : role === 'above' ? S_CELL : PLACE_MASK
}

/**
 * THE PATHFINDER'S PRICE -> (block) => 0 | ZONE_COST, for exclusionAreasBreak AND exclusionAreasPlace. `zones()` returns
 * the cached list (no fs, no allocation in the A* step). Zones off -> always 0.
 */
export function zoneCost (zones, { feet = () => null, grow = 0, nameRule = zoneGuardOn() } = {}) {
  return (block) => {
    const list = zones()
    if (!list || !list.length) return 0
    const p = block?.position
    if (!p) return 0
    // A PLACEMENT (grow): the guard's cells, with the same exemption (placeBlocked) -- no plan the guard then refuses
    if (grow) return placeBlocked(list, p.x, p.y, p.z, feet()) ? ZONE_COST : 0
    // ZONEGUARD-01SHOW: a break is the chokepoint's dig -- a baseline cell or a support at any depth, a deep structure by name
    // where the zone has no baseline, else the old rule
    const f = feet()
    return (structAt(list, p.x, p.y, p.z, DIG_MASK) || deepNameBlocked(list, p.x, p.y, p.z, block?.name, f, { on: nameRule }) ||
            blocked(list, p.x, p.y, p.z, f, true)) ? ZONE_COST : 0
  }
}

/**
 * A ZONE AS A KEEP-OUT PART for minewell's composeKeepOut -> { forbid(cell) -> 'protected' | null, bottom }. Pure over
 * the list: EVERY cell of a zone's box is forbidden (air too: a stair never runs through a zone, and never starts in one).
 */
export function zoneKeepOut (zones, feet = null) {
  if (!zones || !zones.length) return { forbid: null, bottom: null }
  return { forbid: c => (c && blocked(zones, c.x, c.y, c.z, feet) ? 'protected' : null), bottom: Math.min(...zones.map(q => q.y0)) }
}

/**
 * THE COLUMNS JUST BEYOND A ZONE a bot over it may start a stair from -> [{ x, z }], nearest first. Pure. For every zone
 * whose footprint (grown by `margin`) holds the bot: its exit point, then the ring EXIT_PAD outside the box every `step`
 * blocks (the planner judges each against every keep-out, so a well or a second zone beside one is passed over).
 */
export function zoneExitColumns (zones, from, { step = 6, margin = 3 } = {}) {
  if (!zones || !zones.length || !from) return []
  const fx = Math.floor(from.x), fz = Math.floor(from.z), out = [], seen = new Set()
  const add = c => { const k = `${c.x},${c.z}`; if (!seen.has(k)) { seen.add(k); out.push(c) } }
  for (const q of zones) {
    if (!overFootprint(q, from, margin)) continue
    const ex = exitPoint(q, { x: Math.min(Math.max(fx, q.x0), q.x1), z: Math.min(Math.max(fz, q.z0), q.z1) })
    if (ex) add({ x: ex.x, z: ex.z })
    const ring = []
    const X0 = q.x0 - EXIT_PAD, X1 = q.x1 + EXIT_PAD, Z0 = q.z0 - EXIT_PAD, Z1 = q.z1 + EXIT_PAD
    for (let x = X0; x <= X1; x += step) ring.push({ x, z: Z0 }, { x, z: Z1 })
    for (let z = Z0; z <= Z1; z += step) ring.push({ x: X0, z }, { x: X1, z })
    const d = c => Math.hypot(c.x - fx, c.z - fz)
    ring.sort((a, b) => d(a) - d(b) || a.x - b.x || a.z - b.z).forEach(add)
  }
  return out
}

/**
 * THE LIVE LIST for one bot -> { zones(), state(), refresh() }. `zones()` and `state()` never touch the disk (Claude r1 P2:
 * zones() is read inside the A* step); `refresh()` does, and the caller runs it once at spawn and on a RELOAD_MS timer.
 * The file is re-parsed only when its mtime, size or this bot's world id changed.
 *   gone (ENOENT)                  -> zones OFF: removing the file is the rollback
 *   unreadable JSON / bad version  -> the LAST GOOD list stays (Claude r1 P2: a hand edit or a torn write must not switch a
 *                                     world's protection off); state() says `stale:<why>` until a good read
 * `onChange(state)` is called whenever the state changes (the caller logs it). Never throws.
 */
export function zoneReader ({ file, worldId = () => null, fsx = fs, onChange = () => {}, baseline = () => null, guardOn = zoneGuardOn() } = {}) {
  let sig = null, list = [], st = { why: 'unread', bad: [], file: null, n: 0 }
  // ZONEGUARD-01SHOW: the tripwire's baseline, read beside the zones file (its own signature; the same keep-last-good rule)
  let bsig = null, base = null, bst = { why: guardOn ? 'unread' : 'off', file: null }, joined = [], joinedOf = null
  let fileSt = st
  const set = next => { fileSt = next }
  const off = f => { sig = null; list = []; set({ why: 'absent', bad: [], file: f, n: 0 }) }
  const keep = (why) => set({ ...fileSt, why: `${list.length ? 'stale' : 'unreadable'}:${why}` })
  const refreshBase = () => {
    if (!guardOn) { base = null; bsig = null; bst = { why: 'off', file: null }; return }
    let f = null
    try { f = baseline() } catch { f = null }
    if (!f) { base = null; bsig = null; bst = { why: 'absent', file: null }; return }
    let s2
    try { s2 = fsx.statSync(f) } catch (e) {
      if (e?.code === 'ENOENT') { base = null; bsig = null; bst = { why: 'absent', file: f }; return }
      bst = { ...bst, why: `${base ? 'stale' : 'unreadable'}:${String(e?.message ?? e).slice(0, 60)}` }; return
    }
    const m = `${s2.mtimeMs}:${s2.size}`
    if (m === bsig) return
    let raw
    try { raw = JSON.parse(fsx.readFileSync(f, 'utf8')) } catch (e) { bst = { ...bst, why: `${base ? 'stale' : 'unreadable'}:${String(e?.message ?? e).slice(0, 60)}`, file: f }; return }
    const r = parseBaseline(raw)
    if (r.why === 'not_a_baseline') { bst = { ...bst, why: `${base ? 'stale' : 'unreadable'}:${r.why}`, file: f }; return }
    bsig = m; base = r; bst = { why: r.why, file: f }
  }
  const refresh = () => {
    const was = JSON.stringify(st)
    refreshFile()
    refreshBase()
    if (joinedOf !== `${sig}|${bsig}|${list.length}`) {
      const j = withBaseline(list, base)
      joined = j.zones
      joinedOf = `${sig}|${bsig}|${list.length}`
      bst = { ...bst, guarded: j.state.guarded, cells: j.state.cells, missing: j.state.missing, orphan: j.state.orphan, bad: j.state.bad }
    }
    st = { ...fileSt, base: bst }
    if (JSON.stringify(st) !== was) { try { onChange(st) } catch { /* telemetry */ } }
  }
  const refreshFile = () => {
    let f = null
    try { f = file() } catch { f = null }
    if (!f) return off(f)
    let s
    try { s = fsx.statSync(f) } catch (e) { return e?.code === 'ENOENT' ? off(f) : keep(String(e?.message ?? e).slice(0, 60)) }
    const m = `${s.mtimeMs}:${s.size}:${worldId() ?? ''}`
    if (m === sig) return
    let raw
    try { raw = JSON.parse(fsx.readFileSync(f, 'utf8')) } catch (e) { return e?.code === 'ENOENT' ? off(f) : keep(String(e?.message ?? e).slice(0, 60)) }
    if (raw == null) return keep('null')   // a file holding JSON null is broken, not absent (Codex r2 P2)
    const r = parseZones(raw, { worldId: worldId() })
    if (/^(bad_version|not_an_object|no_zones)/.test(r.why)) return keep(r.why)
    if (r.why === 'empty' && r.bad.length) return keep(`all_malformed:${r.bad.slice(0, 3).join(',')}`)   // Claude r2 P3
    sig = m
    list = r.zones
    set({ why: r.why, bad: r.bad, file: f, n: r.zones.length, ids: r.zones.map(z => z.id) })
  }
  return { zones: () => joined, state: () => st, refresh }
}

/** Where this bot's tripwire baseline is (zoneguard-01show): PROTECT_ZONES_BASELINE, else beside the zones file, else the
 *  showcase tripwire's own copy. Exists-checked (fsx.existsSync); null when none. */
export function baselinePathFor (dir, { env = typeof process !== 'undefined' ? process.env : {}, fsx = fs } = {}) {
  const e = String(env?.PROTECT_ZONES_BASELINE ?? '').trim()
  if (/^(off|0|false|no)$/i.test(e)) return null
  if (e) return e
  for (const p of [dir ? path.join(dir, BASELINE_FILE) : null, SHOWCASE_BASELINE]) { try { if (p && fsx.existsSync(p)) return p } catch { /* next */ } }
  return null
}

/** The licence row's detail (`_protectzone_mode`, once per spawn and on every change). Pure. */
export function protectZoneModeDetail (st, worldId = null) {
  const b = st?.base
  // zoneguard-01show: the baseline's line -- which zones carry the tripwire's cells, how many, and which do not
  const bl = b ? ` baseline=${b.why ?? '?'}${b.guarded?.length ? ` guarded=${b.guarded.length} cells=${b.cells ?? 0}` : ''}${b.missing?.length ? ` unguarded=${b.missing.join(',')}` : ''}` +
    `${b.orphan?.length ? ` orphan=${b.orphan.join(',')}` : ''}${b.bad?.length ? ` base_bad=${b.bad.join(',')}` : ''}` : ''
  return `zones=${st?.n ?? 0} why=${st?.why ?? '?'}${st?.ids?.length ? ` ids=${st.ids.join(',')}` : ''}${st?.bad?.length ? ` bad=${st.bad.join(',')}` : ''} world=${worldId || 'unknown'}${bl}`
}

/** Per-bot counters for the `_protect_zone` liveness row (one a minute, only when something was refused or filtered). */
export function protectZoneCounters () {
  return { dig: 0, place: 0, use: 0, open: 0, sleep: 0, craft: 0, survival_allowed: 0, struct_refused: 0, liquid_refused: 0, find_filtered: 0, mine_refused: 0, mine_walkout: 0, mine_step_refused: 0, place_refused: 0, bucket_refused: 0 }
}
export function noteProtectZone (bot, key, n = 1) {
  try { if (bot) { bot.protectZone ??= protectZoneCounters(); bot.protectZone[key] = (bot.protectZone[key] ?? 0) + n } } catch { /* telemetry */ }
}

const cellOf = b => (b?.position ? { x: Math.floor(b.position.x), y: Math.floor(b.position.y), z: Math.floor(b.position.z) } : null)

/**
 * A HEIGHT A BOT CAN STAND AT in column (x, z), nearest `y0` within +-8 -> y | null: feet and head open (no liquid), a solid
 * floor. Reads bot.blockAt (an unloaded cell is no answer). mine's far-start probe, for the guard's own remedy.
 */
export function standableY (bot, x, z, y0) {
  if (typeof bot?.blockAt !== 'function' || !Number.isFinite(y0)) return null
  const at = yy => { try { return bot.blockAt(new Vec3(x, yy, z)) } catch { return null } }
  const open = b => !!b && b.boundingBox === 'empty' && !/^(water|lava)$/.test(b.name ?? '')
  const ok = y => { const f = at(y - 1); return !!f && f.boundingBox === 'block' && open(at(y)) && open(at(y + 1)) }
  const b = Math.floor(y0)
  for (let dy = 0; dy <= 8; dy++) for (const y of dy ? [b + dy, b - dy] : [b]) if (ok(y)) return y
  return null
}

/**
 * INSTALL THE GUARD on one bot -> { stop } | null. `zones()` the live list; `context()` { skill, args, holder, reflex }
 * (as digtown reads it); `onRefuse({ op, zone, at, purpose, by, remedy })` telemetry. Installed AFTER attachDigTown so a
 * refused dig never reaches the instrument (it is not a dig). Every wrapper is a pass-through when no zone is loaded.
 */
export function attachProtectZone (bot, { zones, context = () => ({}), onRefuse = () => {}, guardOn = zoneGuardOn() } = {}) {
  if (!bot || typeof zones !== 'function' || bot.__protectZone) return null
  bot.__protectZone = true
  const purposeOf = () => {
    let c = {}
    try { c = context() ?? {} } catch { c = {} }
    // EATING HOLDS NO BODY (Claude r1 P3): pickuplog's activeReflexOf names `eat` when nothing else runs; a skill's dig made
    // while the bot eats is that skill's, never survival
    if (c && c.reflex === 'eat') c = { ...c, reflex: null }
    let mining = false, tag = null
    try { mining = !!bot.pathfinder?.isMining?.(); tag = bot.pathfinder?.movements?.digPurpose ?? null } catch { /* fine */ }
    return digPurpose({ scope: currentDigScope(), pathfinderMining: mining, movementsPurpose: tag, ...c })
  }
  const refuse = (op, zone, at, struct = false) => {
    const { purpose, by } = purposeOf()
    const from = bot.entity?.position ?? null
    const remedy = zoneRemedy(zone, op, at, from, { standY: (x, z) => standableY(bot, x, z, from?.y), struct })
    noteProtectZone(bot, op)
    try { onRefuse({ op, zone: zone.id, at, purpose, by, remedy, struct }) } catch { /* telemetry */ }
    // HANDLED AT BIRTH (Codex r1 P2): mineflayer calls activateBlock UNAWAITED inside openBlock, craft and sleep, and
    // pathfinder chains .catch -- an unobserved rejection must never become an unhandledRejection. Awaiting callers still
    // receive the rejection.
    const p = Promise.reject(new ProtectedZoneError(zone, op, at, remedy))
    p.catch(() => {})
    return p
  }
  /** -> a rejected promise, or null to proceed. `cell.role` (a placement's ref | dest | above) and `cell.name` (a dig's block). */
  const gate = (op, cell) => {
    const list = zones()
    if (!list || !list.length || !cell) return null
    const feet = bot.entity?.position ?? null
    const mask = structMask(op, cell.role)
    // ZONEGUARD-01SHOW: the cheap pre-check -- a baseline cell for this op, a deep structure by name, or the old rule
    const any = (mask && structAt(list, cell.x, cell.y, cell.z, mask)) ||
                (op === 'dig' && deepNameBlocked(list, cell.x, cell.y, cell.z, cell.name, feet, { on: guardOn })) ||
                blocked(list, cell.x, cell.y, cell.z, feet, true)
    if (!any) return null
    const purpose = SURVIVAL_OPS.has(op) ? purposeOf().purpose : null
    const d = zoneDecision({ zones: list, op, cell, purpose, feet, role: cell.role ?? null, name: cell.name ?? null, nameRule: guardOn })
    if (!d) { noteProtectZone(bot, 'survival_allowed'); return null }
    if (d.struct) noteProtectZone(bot, 'struct_refused')
    return refuse(op, d.zone, cell, !!d.struct)
  }
  // THE INNER USE OF AN APPROVED CALL (Codex r1 P2): openBlock, craft and sleep reach bot.activateBlock themselves, UNAWAITED.
  // The outer call was judged; its own activation of the SAME cell passes while it runs, so a zone file re-read between the
  // two can never strand mineflayer waiting for a window that a refused activation will not open.
  const approved = new Map()
  const keyOf = c => `${c.x},${c.y},${c.z}`
  const hold = (cell, run) => {
    if (!cell) return run()
    const k = keyOf(cell)
    approved.set(k, (approved.get(k) ?? 0) + 1)
    const done = () => { const n = (approved.get(k) ?? 1) - 1; if (n > 0) approved.set(k, n); else approved.delete(k) }
    let r
    try { r = run() } catch (e) { done(); throw e }
    if (r && typeof r.then === 'function') { r.then(done, done); return r }
    done(); return r
  }
  const wrap = (name, op, cellsFor, { approve = false } = {}) => {
    const orig = bot[name]
    if (typeof orig !== 'function') return
    const w = function (...a) {
      let cells = []
      try { cells = cellsFor(...a).filter(Boolean) } catch { cells = [] }
      if (op === 'use' && cells.length && approved.has(keyOf(cells[0]))) return orig.apply(this, a)
      for (const c of cells) { const r = gate(op, c); if (r) return r }
      return approve ? hold(cells[0], () => orig.apply(this, a)) : orig.apply(this, a)
    }
    w.__protectZone = orig
    bot[name] = w
  }
  wrap('dig', 'dig', b => { const c = cellOf(b); return [c ? { ...c, name: b?.name ?? null } : null] })   // the name: deepNameBlocked
  // A PLACEMENT TOUCHES THREE CELLS (Codex r1 P1): the REFERENCE (mineflayer sends a use-item-on packet AT it: a protected
  // chest or door would open or toggle; a replaceable reference is replaced), the destination reference + face, and the cell
  // above it (a door's or a tall plant's upper half)
  wrap('_genericPlace', 'place', (ref, face) => {
    if (!ref?.position || !face) return []
    const d = { position: { x: ref.position.x + face.x, y: ref.position.y + face.y, z: ref.position.z + face.z } }
    // ZONEGUARD-01SHOW: each cell's ROLE -- the reference changes nothing (old rule only), the destination may not be a baseline
    // cell or a path's cover, the cell above it not a baseline cell
    const tag = (c, role) => (c ? { ...c, role } : null)
    return [tag(cellOf(ref), 'ref'), tag(cellOf(d), 'dest'), tag(cellOf({ position: { x: d.position.x, y: d.position.y + 1, z: d.position.z } }), 'above')]
  })
  wrap('activateBlock', 'use', b => [cellOf(b)])
  wrap('openBlock', 'open', b => [cellOf(b)], { approve: true })
  wrap('sleep', 'sleep', b => [cellOf(b)], { approve: true })
  wrap('craft', 'craft', (_r, _n, table) => [cellOf(table)], { approve: true })
  // ZONEGUARD-01SHOW (Codex r1 blocker 2): A POUR IS NO PLACEMENT this guard sees (bucket.mjs: equip -> lookAt -> activateItem).
  // With a liquid in hand, a use from where its flow could reach a baseline cell is not sent (the reach covers the bot's own
  // flow is traced from the feet, the head and the aimed face: liquidFlowReaches). activateItem is synchronous in mineflayer and every pour verifies the world afterwards, so a
  // use not sent reads as a pour that did not take. Eating, a bow, an empty bucket: untouched.
  const use = bot.activateItem
  if (typeof use === 'function') {
    const w = function (...a) {
      const held = bot.heldItem?.name ?? ''
      if (/^(water|lava|powder_snow|cod|salmon|pufferfish|tropical_fish|axolotl|tadpole)_bucket$/.test(held)) {
        const list = zones()
        const p = bot.entity?.position
        let z = null
        if (list?.length && p) {
          // THE FLOW'S SEEDS: the feet and head cells and the cell in front of the face the bot is aiming at (and its faces)
          const f = [Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)]
          const seeds = [f, [f[0], f[1] + 1, f[2]]]
          let cur = null
          try { cur = bot.blockAtCursor?.(5) ?? null } catch { cur = null }
          if (cur?.position) for (const [dx, dy, dz] of [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) seeds.push([cur.position.x + dx, cur.position.y + dy, cur.position.z + dz])
          const atB = typeof bot.blockAt === 'function' ? (x, y, zz) => { try { return bot.blockAt(new Vec3(x, y, zz)) } catch { return null } } : null
          try { z = liquidFlowReaches(list, seeds, atB, { lava: held === 'lava_bucket' }) } catch { z = list[0] }
        }
        if (z) {
          noteProtectZone(bot, 'liquid_refused')
          try { onRefuse({ op: 'pour', zone: z.id, at: { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) }, purpose: purposeOf().purpose, by: purposeOf().by, struct: true,
            remedy: `protected zone: ${z.label} -- a ${held.replace(/_bucket$/, '')} pour here could run into its structure (the flow traced from here reaches it, or could not be traced); pour where the ground does not fall toward it, farther away` }) } catch { /* telemetry */ }
          return undefined
        }
      }
      return use.apply(this, a)
    }
    w.__protectZone = use
    bot.activateItem = w
  }
  // THE ENUMERATION: findBlocks never answers a zone cell. mineflayer calls `matching` twice per candidate: with a
  // position-less palette Block (the section pre-check: passed through), then with bot.blockAt(point) -- that call is
  // judged. A search whose sphere meets no zone is handed through untouched.
  const find = bot.findBlocks
  if (typeof find === 'function') {
    const w = function (options = {}) {
      const list = zones()
      if (!list || !list.length) return find.call(this, options)
      // mineflayer's own defaults (blocks.js:158-159: `options.point || bot.entity.position`, `options.maxDistance || 16`)
      const point = options.point || bot.entity?.position
      if (!zonesNear(list, point, options.maxDistance || 16)) return find.call(this, options)
      const m = options.matching
      const inner = typeof m === 'function' ? m : (() => { const ids = Array.isArray(m) ? m : [m]; return b => (b == null ? false : ids.indexOf(b.type) >= 0) })()
      let filtered = 0
      const feet = bot.entity?.position ?? null
      const matching = b => {
        if (!inner(b)) return false
        const p = b?.position
        if (p && (blocked(list, p.x, p.y, p.z, feet) || deepNameBlocked(list, p.x, p.y, p.z, b?.name, feet, { on: guardOn }))) { filtered++; return false }   // zoneguard-01show
        return true
      }
      const out = find.call(this, { ...options, matching })
      if (filtered) noteProtectZone(bot, 'find_filtered', filtered)
      return out
    }
    w.__protectZone = find
    bot.findBlocks = w
  }
  return { stop: () => {} }
}

/** The file's path for this bot's town (the pool's own directory). */
export const zonesFileIn = dir => path.join(dir, ZONES_FILE)
