// THE TOWN JUNK WELL: a pickup-proof place to throw the junk nothing else takes.
//
// WHY (owner, 10-04): eggs, flint, clay, ink sacs and scutes have NO exit from a bag -- not compostable, not bankable,
// no recipe the fleet uses -- and they sit in full bags (150+64+72 slots across 64 full bags on 10-04). The owner
// accepted vanilla's 5-minute despawn as the INTERIM disposal; the well holds the items out of every player's reach
// until it runs out. Design: docs/reports/disposal-design-2026-10-04.md (Claude), disposal-design-codex-2026-10-04.md
// (Codex: admission and the underground neighbour are adopted), junk-well-sandbox-2026-10-04.md (Paper 1.21.8).
//
// THE GEOMETRY (g = the ground layer; bots walk with their feet at g+1):
//
//   y=g+1   . . . . .       the rim: bots walk here
//   y=g     S [T] S         T = a wooden trapdoor, TOP half, closed = flush with the ground (13/16..16/16 of the cell)
//   y=g-1   S [B] S         B = a second wooden trapdoor (the recipe makes 2), BOTTOM half (0..3/16) on the shaft floor
//   y=g-2   S  S  S         solid, non-falling floor
//
// - PICKUP: vanilla's box reaches 0.75 BELOW the feet (pickupbox.mjs). An item rests on B at g-1+3/16 = g-0.8125, so a
//   body on the rim (feet g+1) is 1.8125 above it, and nothing can stand lower within 1.425 horizontally: the walls and
//   a 2-wide underground ring at g-3..g-1 must be solid (wellSiteRefusal; Codex's underground-neighbour point).
// - MOBS (sandbox scene 5): under a closed top trapdoor alone the clear height was 1.8125 -- a creeper (1.7) fits and
//   the shaft is dark at all hours. With B on the floor the clear height is g+0.8125 - (g-1+0.1875) = 1.625 < 1.7, a
//   spawn AT g-1 collides with B, and a spawn at g has no sturdy floor under it (B's top face is not full).
// - MERGE: merge-radius.item 0.5 on all 20 worlds -> Paper's vertical merge inflation is 0.0; a well item never merges
//   with anything at the surface.
// - DESPAWN: 6000 ticks of a TICKING chunk (sandbox: the age pauses when no player keeps the chunk loaded; the items
//   stay contained meanwhile).
//
// TWO HAZARDS THE SANDBOX MEASURED, AND WHAT ANSWERS THEM:
// - pathfinder treats an OPEN trapdoor as floor (static boundingBox); crossing at walking speed never fell (0/12), but
//   a bot whose GOAL was the well cell fell in 2/2. So: no node of any movement profile may stand in the well column
//   (wellStepCost, every profile), no goal of ours ever names it, and the trapdoor opens only when no other player is
//   within 5 blocks (wellAdmission) and closes in a finally.
// - a toss can miss (1 of 118 on the sandbox, from the 1.15 stand): misses are tracked by entity and retaken.
//
// Nothing here is ever the model's choice: three deterministic town orders (wellOrder), never a trip.

import { TRIGGER_SLOTS } from './hygiene.mjs'
import { isCompostJunk, townDistance, ADOPT_RADIUS, TOWN_RADIUS, CLEARANCE_CONTAINER,
         builderDecision, RUNNER_DECLINED } from './composter.mjs'
import { chainPeak } from './craftroom.mjs'

/** The admission radius, needed by the site search above its definition (see ADMISSION_RADIUS). */
const ADMISSION_RADIUS_FOR_SITE = 5

// ---- what goes in ---------------------------------------------------------------------------------------------------

/**
 * THE OWNER'S LIST (10-04): junk with no use to this fleet. The eight from the owner (three eggs, flint, clay_ball, two
 * ink sacs, armadillo_scute) and the design's three non-compostable NEVER_KEEP decorations. NOTHING ELSE, EVER: no
 * cobblestone, ballast, tools, food, wood, saplings, ores, and nothing the composter takes (it is live fleet-wide and
 * handles plant litter). The allowlist IS the safety; isWellJunk re-checks it against the guards below.
 */
export const OWNER_JUNK_1004 = Object.freeze(['egg', 'brown_egg', 'blue_egg', 'flint', 'clay_ball', 'ink_sac', 'glow_ink_sac',
  'armadillo_scute', 'dead_bush', 'pointed_dripstone', 'rail'])

const DECO_WOODS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'cherry', 'dark_oak', 'pale_oak', 'mangrove', 'bamboo', 'crimson', 'warped']
const COLOURS = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue',
  'brown', 'green', 'red', 'black']

/**
 * OWNER 10-07 DECORATIONS ("yes": pointed_dripstone, diorite, granite, andesite, buttons, rails, leads, wool, glass, bricks,
 * stone_bricks "and similar"). Built from the 10-07 17:00Z bag census (80 bots; ~300 decoration slots) and checked against
 * every consumer in bots/src (recipes, craftplan/milestones, smelting fuel, composter build, scaffold/pillar/rescue
 * block lists, exit contract, bankable/towndeposit keeps) and the tree-farm blueprint (bp-on-1918bb5: torches, saplings,
 * dirt, bone meal only). Each has NO consumer:
 *   glass, glass_pane, stained glass + panes   smelting.mjs MAKES glass from sand; nothing uses it (census 59 slots)
 *   wool (16 colours)                          no recipe the fleet runs; the sleep skill uses a BED it carries, never wool
 *   buttons, pressure plates (wood + stone)    not fuel here (smelting.mjs FUEL_ORDER: coal, kelp block, bamboo, planks,
 *                                              logs, sticks) and no recipe input
 *   rails (powered, detector, activator)       'rail' was already listed; the metal in them cannot be recovered
 *   lead                                       no use
 *   brick, bricks, mossy/cracked/chiseled stone bricks   smelting MAKES brick from clay; nothing uses either
 *   polished andesite/diorite/granite, smooth_basalt, polished_tuff, tuff_bricks, chiseled_tuff_bricks   on no
 *                                              scaffold, pillar, rescue or stockpile list (those name the raw blocks)
 *   wooden fences (+ nether_brick_fence)       not fuel here, not a recipe input the fleet runs
 * NOT LISTED, ON PURPOSE: wooden SLABS (the composter is crafted from 7 -- composter.mjs townBuildPlan), trapdoors (the
 * well is built from them), beds (the sleep skill), doors and stairs (one slot fleet-wide each), sandstone (a rescue and
 * pillar block in desert worlds), calcite and tuff (raw ballast the stone rung counts), magma_block, amethyst, and
 * anything compostable (flowers, moss, wildflowers: the composter's -- isWellJunk refuses those anyway).
 */
export const DECORATIONS = Object.freeze([
  'glass', 'glass_pane', ...COLOURS.map(c => `${c}_stained_glass`), ...COLOURS.map(c => `${c}_stained_glass_pane`),
  ...COLOURS.map(c => `${c}_wool`),
  ...DECO_WOODS.map(w => `${w}_button`), 'stone_button', 'polished_blackstone_button',
  ...DECO_WOODS.map(w => `${w}_pressure_plate`), 'stone_pressure_plate', 'polished_blackstone_pressure_plate',
  'powered_rail', 'detector_rail', 'activator_rail',
  'lead',
  'brick', 'bricks', 'mossy_stone_bricks', 'cracked_stone_bricks', 'chiseled_stone_bricks',
  'polished_andesite', 'polished_diorite', 'polished_granite', 'smooth_basalt', 'polished_tuff', 'tuff_bricks', 'chiseled_tuff_bricks',
  ...DECO_WOODS.map(w => `${w}_fence`), 'nether_brick_fence',
])

/**
 * SCAFFOLD-CAPABLE DECORATIONS (owner 10-07: diorite, granite, andesite, stone_bricks "and similar"). These ARE used:
 * mineflayer-pathfinder builds with them (scaffold.mjs PATHFINDER_SCAFFOLD), the pillar and rescue reflexes place them
 * (reflex.mjs PLACEABLE, skills.mjs RESCUE_BLOCK), and the exit contract counts the raw three as climb-out blocks
 * (exit-contract.mjs scaffoldCount). So they go down the well ONLY while the bag also holds STONE_GUARD cobblestone +
 * cobbled_deepslate, which every one of those lists accepts and which covers the exit contract's reserve for an
 * iron-depth descent (y 16 at sea level 63: debt 47 + reserve 12 = 59 blocks). Below the guard they stay as scaffold.
 */
export const SCAFFOLD_DECORATIONS = Object.freeze(['andesite', 'diorite', 'granite', 'stone_bricks', 'mossy_cobblestone', 'smooth_stone'])
export const STONE_GUARD = 64
const GUARD_STONE = new Set(['cobblestone', 'cobbled_deepslate'])
const SCAFFOLD_DECO = new Set(SCAFFOLD_DECORATIONS)

export const WELL_JUNK = Object.freeze(new Set([...OWNER_JUNK_1004, ...DECORATIONS, ...SCAFFOLD_DECORATIONS]))

/** Belt and braces: never disposed whatever a list says. (andesite, diorite and granite left this guard on the owner's
 *  10-07 "yes"; STONE_GUARD holds them back instead.) */
const NEVER_DISPOSE = /(_(pickaxe|axe|shovel|hoe|sword)$|_log$|_wood$|_stem$|_planks$|_sapling$|_propagule$|_ore$|^raw_|_ingot$|_slab$|_trapdoor$|_bed$|^(cobblestone|cobbled_deepslate|stone|dirt|tuff|gravel|sand|netherrack|calcite|deepslate|sandstone|red_sandstone)$|^(apple|bread|carrot|potato|baked_potato|beetroot|melon_slice|sweet_berries|glow_berries|cookie)$|^(cooked_)?(beef|porkchop|chicken|mutton|rabbit|cod|salmon)$|^(stick|coal|charcoal|torch|crafting_table|chest|bone_meal|bamboo)$)/

/** May this item go down the well? On the list, AND not a guarded kind, AND not something the composter takes. */
export function isWellJunk (name) {
  return typeof name === 'string' && WELL_JUNK.has(name) && !NEVER_DISPOSE.test(name) && !isCompostJunk(name)
}

/** cobblestone + cobbled_deepslate in a bag (mineflayer Items or { name, count }). */
export function guardStone (items = []) {
  let n = 0
  for (const it of (Array.isArray(items) ? items : [])) if (it?.name && GUARD_STONE.has(it.name)) n += Number(it.count) || 0
  return n
}

/** May THIS stack go down the well from THIS bag? isWellJunk, and a scaffold-capable decoration only at STONE_GUARD+. */
export function disposableIn (name, items = []) {
  if (!isWellJunk(name)) return false
  return !SCAFFOLD_DECO.has(name) || guardStone(items) >= STONE_GUARD
}

/** At most this many stacks per visit: one click each, and the open window should stay short. */
export const MAX_STACKS_PER_VISIT = 9

/**
 * disposePlan(items) -> { slots, junkStacks, stone, stacks: [{ slot, name, count }] }. Pure.
 * WHOLE stacks of listed junk only (a whole stack is a whole slot freed), in slot order, at most MAX_STACKS_PER_VISIT;
 * a scaffold-capable decoration only while the bag holds STONE_GUARD guard stone (`stone`, written on the row).
 * `junkStacks` counts every listed stack in the bag (what the trigger reads).
 */
export function disposePlan (items = [], { maxStacks = MAX_STACKS_PER_VISIT } = {}) {
  const list = (Array.isArray(items) ? items : []).filter(it => it?.name && (it.count ?? 0) > 0)
  const junk = list.filter(it => disposableIn(it.name, list) && Number.isInteger(it.slot))
    .sort((a, b) => a.slot - b.slot)
  return { slots: list.length, junkStacks: junk.length, stone: guardStone(list),
           stacks: junk.slice(0, Math.max(0, maxStacks)).map(it => ({ slot: it.slot, name: it.name, count: it.count })) }
}

// ---- the blocks ------------------------------------------------------------------------------------------------------

/** Wooden trapdoors only: a hand opens them, mobs cannot. (Iron needs redstone; copper is left out.) */
export const WOODEN_TRAPDOOR = /^(oak|spruce|birch|jungle|acacia|cherry|dark_oak|pale_oak|mangrove|bamboo|crimson|warped)_trapdoor$/
const LIQUID = /^(water|lava|flowing_water|flowing_lava|bubble_column)$/
/** Ground that may not hold the well up: it falls, it is foliage, or it is not ground at all. */
const NOT_GROUND = /(sand$|gravel$|concrete_powder$|anvil$|^scaffolding$|^pointed_dripstone$|^snow$|_leaves$|^ice$|^packed_ice$|^blue_ice$|_trapdoor$|_door$|_gate$|^chest$|^trapped_chest$|^barrel$|^composter$|^crafting_table$|furnace$|^smoker$|^hopper$|shulker_box$|^bedrock$|^spawner$|_bed$)/
/** A cell a bot stands on must be a full cube (feet exactly at g+1). */
const NOT_FULL = /(_slab$|_stairs$|^dirt_path$|^farmland$|_wall$|_fence$|_pane$|_carpet$|^soul_sand$|^mud$|^snow$)/
/** The shaft is dug by hand or tool: dirt 0.5, stone 1.5, logs 2. Harder than this (obsidian, ores' deepslate) is refused. */
export const MAX_DIG_HARDNESS = 2

const solid = b => !!b && b.boundingBox === 'block'
const passable = b => !!b && b.boundingBox === 'empty' && !LIQUID.test(b.name ?? '')
const isTrap = (b, half = null) => !!b && WOODEN_TRAPDOOR.test(b.name ?? '') && (!half || b.props?.half === half)
/**
 * A FULL COLLISION CUBE (Codex review): boundingBox 'block' also covers iron bars, panes, walls and fences, whose gaps a
 * body can stand in. Containment counts only a block whose collision shape is exactly the unit cube.
 */
export const fullCube = b => solid(b) && Array.isArray(b.shapes) && b.shapes.length === 1 &&
  b.shapes[0].length === 6 && b.shapes[0].every((v, i) => Math.abs(v - (i < 3 ? 0 : 1)) < 1e-9)
const ground = b => fullCube(b) && !NOT_GROUND.test(b.name ?? '') && !LIQUID.test(b.name ?? '')
const diggable = b => ground(b) && Number.isFinite(b.hardness) && b.hardness >= 0 && b.hardness <= MAX_DIG_HARDNESS

/** The well's cells from its CAP (the trapdoor's cell, at ground level g). */
export const wellCells = cap => ({ cap: { x: cap.x, y: cap.y, z: cap.z }, shaft: { x: cap.x, y: cap.y - 1, z: cap.z },
                                   floor: { x: cap.x, y: cap.y - 2, z: cap.z }, rim: { x: cap.x, y: cap.y + 1, z: cap.z } })

/** Facing -> the unit step from the cap to the STAND (the facing side: the open flap stands on the far side). */
export const FACING = Object.freeze({ north: { x: 0, z: -1 }, south: { x: 0, z: 1 }, west: { x: -1, z: 0 }, east: { x: 1, z: 0 } })
const FACING_ORDER = ['north', 'south', 'west', 'east']

/** Where the thrower stands for a well whose cap faces `facing`: feet at g+1 on the facing side. */
export function standForFacing (cap, facing) {
  const f = FACING[facing]
  return f ? { x: cap.x + f.x, y: cap.y + 1, z: cap.z + f.z } : null
}

/**
 * EVERY CELL A THROWER MAY USE, best first -> [{ x, y, z, side }]. Pure. The facing side, then the two sides along the
 * flap (Claude review P2-2: one unreserved stand made a chest, a sapling or a scaffold block on it the end of the well).
 * Never the hinge side: the open flap stands on that edge, between the thrower and the opening.
 */
export function standCandidates (cap, facing) {
  const f = FACING[facing]
  if (!f) return []
  const side = [{ x: f.z, z: f.x }, { x: -f.z, z: -f.x }]
  return [{ x: cap.x + f.x, y: cap.y + 1, z: cap.z + f.z, side: 'front' },
          ...side.map((d, i) => ({ x: cap.x + d.x, y: cap.y + 1, z: cap.z + d.z, side: i ? 'left' : 'right' }))]
}

/** The stand cells a bot can stand in right now (feet and head open, full solid floor), in candidate order. Pure. */
export function usableStands (read, cap, facing) {
  if (typeof read !== 'function') return []
  return standCandidates(cap, facing).filter(c => {
    const feet = read(c.x, c.y, c.z), head = read(c.x, c.y + 1, c.z), under = read(c.x, c.y - 1, c.z)
    return passable(feet) && passable(head) && ground(under) && !NOT_FULL.test(under.name ?? '')
  })
}

/**
 * THE CELLS THE WELL NEEDS LEFT EMPTY: its column above the cap and every stand. Other town builders (chest-full's
 * chestSiteRefusal, the composter's siteRefusal, planting) should refuse them; until they do, a blocked set of stands
 * is a breach and the town builds a new well (wellBreach).
 */
export const wellReservedCells = (cap, facing) => [{ x: cap.x, y: cap.y + 1, z: cap.z }, ...standCandidates(cap, facing).map(({ x, y, z }) => ({ x, y, z }))]

/**
 * IS THIS BUILT WELL STILL A WELL? -> reason | null. Pure. Its shaft is sealed (containmentRefusal) and at least one
 * stand is usable. Either failure makes the town build a new one; the old one stays excluded from every path.
 */
export function wellBreach (read, cap, facing) {
  const c = containmentRefusal(read, cap)
  if (c) return c   // 'unknown' when a cell is not loaded: the CALLER decides later, never "breached" (review 8f73e80)
  if (!usableStands(read, cap, facing).length) {
    // AN UNLOADED STAND IS NOT A BLOCKED STAND: right after login a neighbouring chunk may still be on its way
    const unread = standCandidates(cap, facing).some(st => [st.y, st.y + 1, st.y - 1].some(y => !read(st.x, y, st.z)))
    return unread ? 'unknown' : 'every throwing stand is blocked'
  }
  return null
}

/**
 * IS THIS A WELL? -> { ok, open, facing, floor }. Pure. The marker is the cap: a wooden trapdoor, TOP half, over a shaft
 * that is either the floor trapdoor (bottom half) or open air, over solid ground. Towns have no other trapdoors.
 */
export function wellIdentity (read, cap) {
  const no = { ok: false, open: false, facing: null, floor: false }
  if (typeof read !== 'function' || !cap) return no
  const { shaft, floor } = wellCells(cap)
  const c = read(cap.x, cap.y, cap.z), s = read(shaft.x, shaft.y, shaft.z), f = read(floor.x, floor.y, floor.z)
  if (!isTrap(c, 'top') || !solid(f)) return no
  const floored = isTrap(s, 'bottom')
  if (!floored && !passable(s)) return no
  const open = c.props?.open === true || c.props?.open === 'true'
  return { ok: true, open, facing: FACING[c.props?.facing] ? c.props.facing : null, floor: floored }
}

/**
 * HOW FAR ALONG IS A BUILD AT THIS CAP? -> 'fresh' | 'half_dug' | 'dug' | 'floored' | 'built' | 'invalid'. Pure. Every
 * build visit resumes from here, so a visit that is interrupted between digging and capping leaves a pit the next
 * visit finishes (the column is excluded from every path meanwhile).
 */
export function wellStage (read, cap) {
  if (typeof read !== 'function' || !cap) return 'invalid'
  const { shaft } = wellCells(cap)
  const c = read(cap.x, cap.y, cap.z), s = read(shaft.x, shaft.y, shaft.z)
  if (!c || !s) return 'invalid'
  if (isTrap(c, 'top') && (isTrap(s, 'bottom') || passable(s))) return 'built'
  if (passable(c) && isTrap(s, 'bottom')) return 'floored'
  if (passable(c) && passable(s)) return 'dug'
  if (passable(c) && diggable(s)) return 'half_dug'
  if (diggable(c) && diggable(s)) return 'fresh'
  return 'invalid'
}

/**
 * WHERE THE THROWER STANDS AND WHAT THE CAP HANGS ON -> { stand, hinge, face, facing } | null. Pure. A cardinal neighbour
 * whose feet and head cells are open, over a full solid block; the cap is placed against the OPPOSITE neighbour (the
 * hinge), clicking the face that looks at the cap, so the trapdoor faces the stand and its open flap stands on the far
 * side (sandbox: facing=north -> open shape z 13/16..16/16). Fixed order north, south, west, east.
 */
export function wellStand (read, cap) {
  if (typeof read !== 'function' || !cap) return null
  for (const facing of FACING_ORDER) {
    const f = FACING[facing]
    const stand = { x: cap.x + f.x, y: cap.y + 1, z: cap.z + f.z }
    const feet = read(stand.x, stand.y, stand.z), head = read(stand.x, stand.y + 1, stand.z), under = read(stand.x, cap.y, stand.z)
    const hinge = { x: cap.x - f.x, y: cap.y, z: cap.z - f.z }
    if (!passable(feet) || !passable(head) || !ground(under) || NOT_FULL.test(under.name ?? '')) continue   // ground() is a full cube
    if (!ground(read(hinge.x, hinge.y, hinge.z))) continue
    return { stand, hinge, face: { x: f.x, y: 0, z: f.z }, facing }
  }
  return null
}

/** Within this of a liquid the well is refused: water would carry items out, lava would burn the cap. */
export const LIQUID_CLEARANCE = 3
/** Underground, every cell this far around the shaft (horizontally, at g-3..g-1) must be solid: nobody stands near it. */
export const UNDERGROUND_RING = 2
/** Off any chest/composter by this much (composter.mjs MIN_CONTAINER_DISTANCE): a lid must open, a hopper must not pull. */
export const WELL_CONTAINER_DISTANCE = 3

/**
 * WHY THIS CAP CELL CANNOT HOLD THE TOWN WELL -> reason | null (it can). Pure.
 *   read(x,y,z) -> { name, boundingBox, hardness, props } | null   (null = unknown: never on a guess)
 *   avoid       [{x,z}]: other town sites (the composter's) kept WELL_CONTAINER_DISTANCE away
 * Accepts a site part-way through its build (half_dug, dug, floored) so an interrupted build can resume.
 */
export function wellSiteRefusal (read, cap, home = null, { avoid = [] } = {}) {
  if (typeof read !== 'function' || !cap) return 'no site'
  const { x, y: g, z } = cap
  if (home && Math.hypot(x - home.x, z - home.z) < WELL_HOME_CLEARANCE) return 'too near home (bots idle there)'
  const a1 = read(x, g + 1, z), a2 = read(x, g + 2, z), f = read(x, g - 2, z)
  if (!a1 || !a2 || !f) return 'unknown'
  if (!passable(a1) || !passable(a2)) return 'not open above'
  const stage = wellStage(read, cap)
  if (stage === 'built') return 'already a well'
  if (stage === 'invalid') {
    const c = read(x, g, z), s = read(x, g - 1, z)
    if (!c || !s) return 'unknown'
    return `column is ${c.name}/${s.name}`
  }
  if (!ground(f)) return `floor is ${f.name}`
  const breach = containmentRefusal(read, cap)
  if (breach) return breach
  // CONTAINERS AND THE COMPOSTER keep their distance (around the rim cell, where bots stand to use them); doors within 2.
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      for (let dy = -2; dy <= 2; dy++) {
        const near = Math.hypot(dx, dy, dz)
        const door = dy >= 0 && dy <= 1
        if (near >= WELL_CONTAINER_DISTANCE && !door) continue
        const b = read(x + dx, g + 1 + dy, z + dz)
        if (!b) return 'unknown'
        if (near < WELL_CONTAINER_DISTANCE && (CLEARANCE_CONTAINER.test(b.name ?? '') || b.name === 'composter')) return `${b.name} within ${WELL_CONTAINER_DISTANCE}`
        if (door && /_door$|_gate$/.test(b.name ?? '')) return 'door'
      }
    }
  }
  for (const a of (Array.isArray(avoid) ? avoid : [])) {
    const r = Number.isFinite(a?.r) ? a.r : WELL_CONTAINER_DISTANCE
    if (a && Number.isFinite(a.x) && Math.hypot(a.x - x, a.z - z) < r) return `${a.what ?? 'the composter site'} is within ${r}`
  }
  if (!wellStand(read, cap)) return 'nowhere to stand beside it'
  return null
}

/**
 * IS THE SHAFT STILL SEALED? -> reason | null. Pure. The walls (the 8 neighbours at g and g-1: full cubes of solid,
 * non-falling ground), the underground ring and the liquid clearance -- asked of a SITE before it is built and of a BUILT
 * well before every disposal (Codex review: a wall dug out after the build lets a body stand beside the items).
 */
export function containmentRefusal (read, cap) {
  if (typeof read !== 'function' || !cap) return 'no site'
  const { x, y: g, z } = cap
  // THE WALLS: the 8 neighbours at g and g-1 are solid ground (nothing falls into the shaft, nothing stands beside it).
  for (let dy = 0; dy >= -1; dy--) {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (!dx && !dz) continue
        const b = read(x + dx, g + dy, z + dz)
        if (!b) return 'unknown'
        if (!ground(b)) return `wall is ${b.name}`
      }
    }
  }
  // THE UNDERGROUND NEIGHBOUR (Codex): no air, cave or liquid within UNDERGROUND_RING of the shaft at g-3..g-1, so no
  // body can stand low enough beside it to reach an item (the box reaches 1.425 sideways and 2.3 up).
  const R = UNDERGROUND_RING
  for (let dy = -1; dy >= -3; dy--) {
    for (let dx = -R; dx <= R; dx++) {
      for (let dz = -R; dz <= R; dz++) {
        if (!dx && !dz) continue
        const b = read(x + dx, g + dy, z + dz)
        if (!b) return 'unknown'
        if (!fullCube(b) || LIQUID.test(b.name ?? '')) return `underground ${b.name} beside the shaft`
      }
    }
  }
  const L = LIQUID_CLEARANCE
  for (let dy = -1; dy <= 2; dy++) {
    for (let dx = -L; dx <= L; dx++) {
      for (let dz = -L; dz <= L; dz++) {
        const b = read(x + dx, g + dy, z + dz)
        if (!b) return 'unknown'
        if (LIQUID.test(b.name ?? '')) return `${b.name} within ${L}`
      }
    }
  }
  return null
}

const COLUMN_UP = 8, COLUMN_DOWN = 8
/**
 * OFF THE PLACES BOTS STAND (Claude review P2-3: in a flat town the cap landed 2.55 from home, so one bot idling on the
 * home point refused every disposal at ADMISSION_RADIUS 5). The cap is at least this far, horizontally, from home and
 * from every bank container and the composter, so a bot using them is outside the admission radius.
 */
export const WELL_HOME_CLEARANCE = ADMISSION_RADIUS_FOR_SITE + 2
/** Rings searched for the well: WELL_HOME_CLEARANCE out to here (townDistance <= ADOPT_RADIUS still applies). */
export const WELL_SEARCH_RADIUS = 14
/** The fixed ring order composter.mjs uses, starting further out. */
function wellSpiral (home) {
  const out = []
  for (let r = WELL_HOME_CLEARANCE; r <= WELL_SEARCH_RADIUS; r++) {
    const ring = []
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) if (Math.max(Math.abs(dx), Math.abs(dz)) === r) ring.push([dx, dz])
    ring.sort((a, b) => Math.atan2(a[1], a[0]) - Math.atan2(b[1], b[0]) || a[0] - b[0] || a[1] - b[1])
    for (const [dx, dz] of ring) out.push({ x: home.x + dx, z: home.z + dz })
  }
  return out
}
/**
 * THE TOWN'S WELL CELL -> { site, why }. Pure: a function of home and the world only, so every bot that reads the same
 * world gets the same cap cell. In each column the ground under the highest open cell on a solid floor; the first that
 * passes wellSiteRefusal wins. Any UNKNOWN read returns no site.
 *   avoid  [{ x, z, r? }]: places bots stand (the composter, bank containers); the cap stays r (default 3) away
 */
export function canonicalWellSite ({ home, read, avoid = [] } = {}) {
  if (!home || typeof read !== 'function') return { site: null, why: 'no home' }
  const hy = Math.floor(home.y ?? 64)
  for (const { x, z } of wellSpiral(home)) {
    let cap = null
    for (let y = hy + COLUMN_UP; y >= hy - COLUMN_DOWN; y--) {
      const cell = read(x, y, z), under = read(x, y - 1, z)
      if (!cell || !under) return { site: null, why: `unknown cell at ${x},${y},${z}` }
      if (passable(cell) && solid(under)) { cap = { x, y: y - 1, z }; break }
    }
    if (!cap) continue
    if (townDistance(home, { x, y: cap.y + 1, z }) > ADOPT_RADIUS) continue
    const why = wellSiteRefusal(read, cap, home, { avoid })
    if (why === 'unknown') return { site: null, why: `unknown cell near ${x},${cap.y},${z}` }
    if (!why) return { site: cap, why: null }
  }
  return { site: null, why: 'no valid cell for a well near home' }
}

// ---- the toss ---------------------------------------------------------------------------------------------------------

/**
 * VANILLA'S DROP, 1.21.8 (LivingEntity.createItemStackToDrop with throwRandomly=false, as Player.drop(stack, true) runs it
 * for a container THROW click and for a -999 click): the item spawns at the player's x,z and eye - 0.3 (1.32 above the
 * feet) with velocity (-sin(yaw)cos(pitch)*0.3 + cos(a)*m, -sin(pitch)*0.3 + 0.1 + (r1-r2)*0.1, cos(yaw)cos(pitch)*0.3
 * + sin(a)*m), a uniform in [0, 2pi), m uniform in [0, 0.02]. Item physics per tick: vy -= 0.04, move, v *= 0.98.
 */
export const TOSS = Object.freeze({ spawnUp: 1.32, speed: 0.3, lift: 0.1, vyNoise: 0.1, hNoise: 0.02, gravity: 0.04, drag: 0.98,
                                    flap: 0.1875, itemHalf: 0.125 })

/**
 * Where a throw crosses the rim plane -> { x, z } horizontal offset from the feet, or null. Pure. `rise` is how far the
 * feet stand ABOVE the rim (a snow layer of 2-8 has collision: up to 0.875); the item spawns that much higher.
 */
export function tossCrossing ({ ux, uz, pitchDeg, dvy = 0, dvx = 0, dvz = 0, rise = 0 }) {
  const p = pitchDeg * Math.PI / 180
  let vx = ux * Math.cos(p) * TOSS.speed + dvx, vz = uz * Math.cos(p) * TOSS.speed + dvz
  let vy = -Math.sin(p) * TOSS.speed + TOSS.lift + dvy
  let x = 0, z = 0, y = TOSS.spawnUp + Math.max(0, rise)
  for (let t = 0; t < 400; t++) {
    vy -= TOSS.gravity
    const nx = x + vx, ny = y + vy, nz = z + vz
    if (ny <= 0) { const k = y / (y - ny); return { x: x + (nx - x) * k, z: z + (nz - z) * k } }
    x = nx; y = ny; z = nz
    vx *= TOSS.drag; vz *= TOSS.drag; vy *= TOSS.drag
  }
  return null
}

/**
 * THE USABLE OPENING of the cap cell, in world x/z: the cell less the item's half width on every side, and less the
 * open flap's 3/16 on the far side (opposite `facing`). `facing` null = no trapdoor yet (a pit): the whole cell.
 */
export function wellOpening (cap, facing = null) {
  const m = TOSS.itemHalf
  const o = { x0: cap.x + m, x1: cap.x + 1 - m, z0: cap.z + m, z1: cap.z + 1 - m }
  const f = FACING[facing]
  if (f) {   // the flap is on the side the stand is NOT on: -f
    if (f.z === -1) o.z1 -= TOSS.flap
    if (f.z === 1) o.z0 += TOSS.flap
    if (f.x === -1) o.x1 -= TOSS.flap
    if (f.x === 1) o.x0 += TOSS.flap
  }
  return o
}

// A FIXED QUADRATURE over vanilla's noise (deterministic, so the aim is a pure function): the vertical term is
// triangular on [-0.1, 0.1], the horizontal kick uniform in angle and magnitude.
const VY = Array.from({ length: 10 }, (_, k) => { const v = -0.1 + 0.2 * (k + 0.5) / 10; return { v, w: 0.1 - Math.abs(v) } })
const VY_W = VY.reduce((a, b) => a + b.w, 0)
const KICK = []
for (let j = 0; j < 8; j++) for (let i = 0; i < 4; i++) { const a = 2 * Math.PI * (j + 0.5) / 8, m = TOSS.hNoise * (i + 0.5) / 4; KICK.push({ x: Math.cos(a) * m, z: Math.sin(a) * m }) }

/** Where a throw is aimed: the centre of the usable opening (the cell's centre when there is no flap). Pure. */
export function aimTarget (cap, facing = null) {
  const o = wellOpening(cap, facing)
  return { x: (o.x0 + o.x1) / 2, z: (o.z0 + o.z1) / 2 }
}

/** The share of throws from feet `from` at `pitchDeg`, aimed at the opening's centre, that pass through the opening. Pure. */
export function tossHitRate ({ from, cap, facing = null, pitchDeg, rise = 0 }) {
  const t = aimTarget(cap, facing)
  const h = Math.hypot(t.x - from.x, t.z - from.z)
  if (!(h > 1e-6)) return 0
  const ux = (t.x - from.x) / h, uz = (t.z - from.z) / h
  const o = wellOpening(cap, facing)
  let hit = 0
  for (const { v, w } of VY) {
    let n = 0
    for (const k of KICK) {
      const c = tossCrossing({ ux, uz, pitchDeg, dvy: v, dvx: k.x, dvz: k.z, rise })
      if (!c) continue
      const X = from.x + c.x, Z = from.z + c.z
      if (X >= o.x0 && X <= o.x1 && Z >= o.z0 && Z <= o.z1) n++
    }
    hit += w * n / KICK.length
  }
  return hit / VY_W
}

/** Throw from no further than this from the cap's centre (simulation 98.2% at 1.15; sandbox 1 miss in 12 there). */
export const MAX_TOSS_DIST = 1.15
/** ...and no nearer: the body would hang over the opening. */
export const MIN_TOSS_DIST = 0.8
/** A toss is refused below this predicted rate. */
export const MIN_HIT_RATE = 0.9

/**
 * THE AIM -> { pitch, rate, dist, ok, why }. Pure and deterministic. The pitch (degrees DOWN) with the highest predicted
 * rate on a 0.5-degree grid; ties go to the pitch whose noise-free crossing is nearest the opening's centre.
 */
export function wellAim ({ from, cap, facing = null, rise = 0 }) {
  const dist = Math.hypot(cap.x + 0.5 - from.x, cap.z + 0.5 - from.z)
  if (!(dist >= MIN_TOSS_DIST - 1e-9 && dist <= MAX_TOSS_DIST + 1e-9)) return { pitch: null, rate: 0, dist, ok: false, why: `${dist.toFixed(2)} from the well's centre (must be ${MIN_TOSS_DIST}-${MAX_TOSS_DIST})` }
  const { x: mx, z: mz } = aimTarget(cap, facing)
  const th = Math.hypot(mx - from.x, mz - from.z) || 1
  const ux = (mx - from.x) / th, uz = (mz - from.z) / th
  let best = null
  for (let p = 20; p <= 85; p += 0.5) {
    const rate = tossHitRate({ from, cap, facing, pitchDeg: p, rise })
    const c = tossCrossing({ ux, uz, pitchDeg: p, rise })
    const off = c ? Math.hypot(from.x + c.x - mx, from.z + c.z - mz) : Infinity
    if (!best || rate > best.rate + 1e-9 || (Math.abs(rate - best.rate) <= 1e-9 && off < best.off)) best = { pitch: p, rate, off }
  }
  const ok = best.rate >= MIN_HIT_RATE
  return { pitch: best.pitch, rate: best.rate, dist, ok, why: ok ? null : `predicted hit rate ${best.rate.toFixed(3)} below ${MIN_HIT_RATE}` }
}

/** The point to look at so the eye's ray points at the opening's centre, `pitchDeg` below the horizontal. Pure. */
export function aimPoint ({ eye, cap, pitchDeg, facing = null }) {
  const { x: cx, z: cz } = aimTarget(cap, facing)
  const h = Math.hypot(cx - eye.x, cz - eye.z) || 1
  const ux = (cx - eye.x) / h, uz = (cz - eye.z) / h, p = pitchDeg * Math.PI / 180
  return { x: eye.x + ux * Math.cos(p) * 5, y: eye.y - Math.sin(p) * 5, z: eye.z + uz * Math.cos(p) * 5 }
}

/**
 * WHERE DID OUR THROWS GO -> { inWell: [ids], missed: [{ id, x, y, z }] }. Pure. `items` are the item entities this
 * visit's own throws spawned ({ id, x, y, z } read after they settled); in the well = inside the cap's column below
 * the cap's top. Everything else is a miss, to be retaken.
 */
export function tossOutcome ({ items = [], cap }) {
  const inWell = [], missed = []
  for (const it of (Array.isArray(items) ? items : [])) {
    if (!it || !Number.isFinite(it.x)) continue
    const inside = Math.floor(it.x) === cap.x && Math.floor(it.z) === cap.z && it.y < cap.y + 0.5 && it.y > cap.y - 2.5
    if (inside) inWell.push(it.id); else missed.push({ id: it.id, x: it.x, y: it.y, z: it.z })
  }
  return { inWell, missed }
}

/**
 * WHAT WAS THROWN, AS THE SERVER SAYS -> { names: {name: count}, offlist, offlistItems, unnamed }. Pure. `thrown` is
 * [{ name, count }] read from each spawned item entity's metadata (the server's own item stack), name null when none
 * arrived. offlist counts ENTITIES whose item is not on the list: the C3 quantity, independent of the bag plan.
 */
export function thrownNames (thrown = []) {
  const names = {}, offlistItems = {}
  let offlist = 0, unnamed = 0
  for (const t of (Array.isArray(thrown) ? thrown : [])) {
    if (!t?.name) { unnamed++; continue }
    names[t.name] = (names[t.name] ?? 0) + (t.count ?? 1)
    if (!isWellJunk(t.name)) { offlist++; offlistItems[t.name] = (offlistItems[t.name] ?? 0) + (t.count ?? 1) }
  }
  return { names, offlist, offlistItems, unnamed }
}

// ---- admission --------------------------------------------------------------------------------------------------------

/** No other player within this of the well while it is open (sandbox: a bot stopping on an open trapdoor falls in). */
export const ADMISSION_RADIUS = ADMISSION_RADIUS_FOR_SITE

/**
 * MAY THE WELL OPEN NOW? -> null (yes) | { reason, who, dist }. Pure. `players` are the OTHER players' entity feet
 * positions [{ username, x, y, z }]; distance from the rim cell's centre above the cap.
 */
export function wellAdmission ({ players = [], cap, me = null, radius = ADMISSION_RADIUS } = {}) {
  if (!cap) return { reason: 'no_well', who: null, dist: null }
  const cx = cap.x + 0.5, cy = cap.y + 1, cz = cap.z + 0.5
  let near = null
  for (const p of (Array.isArray(players) ? players : [])) {
    if (!p || p.username === me || !Number.isFinite(p.x)) continue
    const d = Math.hypot(p.x - cx, p.y - cy, p.z - cz)
    if (d <= radius && (!near || d < near.dist)) near = { reason: 'player_near', who: p.username ?? '?', dist: d }
  }
  return near
}

// ---- building it -----------------------------------------------------------------------------------------------------

const WOODS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry', 'pale_oak', 'crimson', 'warped']
const logOf = w => (w === 'crimson' || w === 'warped') ? `${w}_stem` : `${w}_log`
/** 3x2 planks of one wood -> 2 trapdoors (minecraft-data 1.21.x; 3 wide: needs a crafting table). */
export const PLANKS_PER_TRAPDOOR_CRAFT = 6
export const TRAPDOORS_PER_CRAFT = 2
const PLANKS_PER_LOG = 4, PLANKS_PER_TABLE = 4

/**
 * wellBuildPlan(counts, { tableAvailable, items }) -> null | { carried, trapdoor, slotsNeeded } | { wood, log, logCrafts,
 * needTable, trapdoor, slotsNeeded }. Pure. Two wooden trapdoors carried (any wood), or the cheapest single-wood route
 * from what is HELD -- never a gather. slotsNeeded is SIMULATED with craftroom's chainPeak when the bag's stacks are given
 * (the planks stack the trapdoor craft empties counts), else the worst case.
 */
export function wellBuildPlan (counts = {}, { tableAvailable = false, items = null, need = 2 } = {}) {
  const carried = Object.entries(counts).filter(([n]) => WOODEN_TRAPDOOR.test(n)).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
  if (carried.reduce((a, [, c]) => a + c, 0) >= Math.max(1, need)) return { carried: true, trapdoor: carried[0][0], slotsNeeded: 0, need }
  let best = null
  for (const wood of WOODS) {
    const planks = counts[`${wood}_planks`] ?? 0, logs = counts[logOf(wood)] ?? 0
    const need = PLANKS_PER_TRAPDOOR_CRAFT + (tableAvailable ? 0 : PLANKS_PER_TABLE)
    const logCrafts = Math.ceil(Math.max(0, need - planks) / PLANKS_PER_LOG)
    if (logCrafts > logs) continue
    const slotsNeeded = Math.ceil(logCrafts * PLANKS_PER_LOG / 64) + (tableAvailable ? 0 : 1) + 1
    const cost = logCrafts
    if (!best || cost < best.cost) best = { wood, log: logOf(wood), logCrafts, needTable: !tableAvailable, trapdoor: `${wood}_trapdoor`, slotsNeeded, cost, need }
  }
  if (!best) return null
  const { cost, ...plan } = best
  if (Array.isArray(items)) {
    const sim = chainPeak(items, wellChainSteps(plan))
    if (sim.ok) return { ...plan, slotsNeeded: sim.slotsNeeded, simulated: true }
  }
  return plan
}

/**
 * HOW MANY TRAPDOORS THE BUILD STILL NEEDS at this stage (Codex review: a floored pit needs only its cap, and a bot
 * carrying that one must be able to finish it). Pure.
 */
export const trapdoorsNeeded = stage => (stage === 'floored' ? 1 : stage === 'built' ? 0 : 2)

/** The build's crafts as craftroom steps, in order (the table is crafted and PUT DOWN when the plan needs one). Pure. */
export function wellChainSteps (plan) {
  if (!plan || plan.carried) return []
  const r = (consumes, outputs) => ({ consumes, outputs: outputs.map(([name, count]) => ({ name, count, stackSize: 64 })) })
  const planks = `${plan.wood}_planks`
  const steps = []
  if (plan.logCrafts) steps.push({ recipe: r([{ name: plan.log, count: 1 }], [[planks, PLANKS_PER_LOG]]), times: plan.logCrafts })
  if (plan.needTable) {
    steps.push({ recipe: r([{ name: planks, count: PLANKS_PER_TABLE }], [['crafting_table', 1]]), times: 1 })
    steps.push({ recipe: r([{ name: 'crafting_table', count: 1 }], []), times: 1 })
  }
  steps.push({ recipe: r([{ name: planks, count: PLANKS_PER_TRAPDOOR_CRAFT }], [[plan.trapdoor, TRAPDOORS_PER_CRAFT]]), times: 1 })
  return steps
}

/**
 * IS THERE ROOM TO BUILD? -> { ok, pitFirst, toss, short }. Pure.
 * The craft chain needs `slotsNeeded` free slots (mineflayer DROPS crafted output with no slot). A bag without them
 * can still build when it holds enough listed junk: the shaft is dug FIRST (digging fills no slot -- the drops fall into
 * the shaft, 1 below the rim, out of the pickup box), `toss` whole junk stacks go down the open pit, and then the chain
 * has its room. This is the refusal's own remedy, executed: a full bag of eggs is exactly the bag the well is for, and
 * "free a slot first" would be a dead end for it.
 */
export function wellBuildRoom ({ free = 0, slotsNeeded = 0, junkStacks = 0 } = {}) {
  const deficit = Math.max(0, slotsNeeded - free)
  if (!deficit) return { ok: true, pitFirst: false, toss: 0, short: 0 }
  if (junkStacks >= deficit) return { ok: true, pitFirst: true, toss: deficit, short: 0 }
  return { ok: false, pitFirst: false, toss: 0, short: deficit - junkStacks }
}

// ---- the scheduler ----------------------------------------------------------------------------------------------------

export const DISPOSE_COOLDOWN_MS = 3 * 60 * 1000
export const DISPOSE_BACKOFF_MS = 15 * 60 * 1000
export const WELL_BUILD_COOLDOWN_MS = 5 * 60 * 1000
export const WELL_BUILD_BACKOFF_MS = 30 * 60 * 1000
export const CLOSE_COOLDOWN_MS = 30 * 1000
/** World scans (well, peers, plan) at most this often per bot, however often it decides. */
export const WELL_SCAN_MS = 30 * 1000
export const WELL_ORDERS = new Set(['dispose_well', 'build_well', 'close_well'])

const lazy = v => (typeof v === 'function' ? v() : v)

/**
 * THE WELL'S TOWN ORDERS -> { order, state }. Pure; cognitive.mjs supplies readings and keeps `state`.
 *   slots, freeSlots, junkStacks, distHome          cheap, evaluated first
 *   well      () -> { open, attended } | null         the town well (attended: another player within ADMISSION_RADIUS)
 *   buildPlan () -> wellBuildPlan | null              what this bot could build from
 *   peers     () -> [names at town]                   one builder per town (composter.mjs builderDecision)
 * Order of precedence: close an open, unattended well (any visitor); dispose at TRIGGER_SLOTS+ holding listed junk;
 * build when the town has none. Cooldowns are charged when an order is ISSUED.
 */
export function wellOrder ({ now = 0, slots = 0, freeSlots = 0, junkStacks = 0, distHome = Infinity, well = null,
                             buildPlan = null, myName = '', peers = [], state = {}, inside = false } = {}) {
  const s = { ...state }
  const none = () => ({ order: null, state: s })
  if (!(distHome <= TOWN_RADIUS)) return none()
  // A BODY INSIDE A WELL GETS NO WELL ORDER (Claude review P2-1: close_well sealed a bot in over its own head). Its way
  // out is the movement profiles, which exempt its own column.
  if (lazy(inside)) return none()
  const closeReady = now - (s.lastCloseAt ?? -Infinity) >= CLOSE_COOLDOWN_MS && now >= (s.closeBackoffUntil ?? 0)
  const disposeReady = now - (s.lastDisposeAt ?? -Infinity) >= DISPOSE_COOLDOWN_MS && now >= (s.disposeBackoffUntil ?? 0) &&
                       slots >= TRIGGER_SLOTS && junkStacks > 0
  const buildReady = now - (s.lastBuildAt ?? -Infinity) >= WELL_BUILD_COOLDOWN_MS && now >= (s.buildBackoffUntil ?? 0)
  if (!closeReady && !disposeReady && !buildReady) return none()
  if (now - (s.lastScanAt ?? -Infinity) < WELL_SCAN_MS) return none()
  s.lastScanAt = now
  const w = lazy(well)
  if (w && !w.breached) {
    if (w.open && !w.attended && closeReady) {
      s.lastCloseAt = now
      return { order: { skill: 'close_well', args: {}, why: 'the town junk well is open and nobody is at it: close it' }, state: s }
    }
    if (disposeReady) {
      s.lastDisposeAt = now
      return { order: { skill: 'dispose_well', args: {}, why: `at town with ${slots} of 36 slots used; ${junkStacks} stack(s) of junk with no use` }, state: s }
    }
    return none()
  }
  if (w?.open && !w.attended && closeReady) {   // a breached well that stands open is still closed
    s.lastCloseAt = now
    return { order: { skill: 'close_well', args: {}, why: 'the town junk well is open and nobody is at it: close it' }, state: s }
  }
  if (!buildReady) return none()
  const plan = lazy(buildPlan)
  if (!plan) return none()
  const room = wellBuildRoom({ free: freeSlots, slotsNeeded: plan.slotsNeeded, junkStacks })
  if (!room.ok) return none()
  s.lastBuildAt = now
  const who = builderDecision({ myName, peers: lazy(peers) ?? [], deferrals: s.deferrals ?? 0 })
  if (who.defer) { s.deferrals = (s.deferrals ?? 0) + 1; return none() }
  s.deferrals = 0
  return { order: { skill: 'build_well', args: {}, why: `at town, no junk well, ${plan.carried ? 'carrying trapdoors' : `holding ${plan.wood} wood`} and ${freeSlots} free slots${room.pitFirst ? ` (${room.toss} junk stack(s) go down the pit first)` : ''}` }, state: s }
}

/** After a well order ran -> the new state. A skip, an interruption or a runner refusal costs nothing; a fault backs off. */
/** Failed closes in a row before close_well backs off, and for how long (Claude review P2-5). */
export const CLOSE_FAILS_BEFORE_BACKOFF = 2
export const CLOSE_BACKOFF_MS = 5 * 60 * 1000

export function wellOrderOutcome (skill, status, now = 0, state = {}, failClass = null) {
  const s = { ...state }
  if (skill === 'close_well') {
    // A CLOSE THAT KEEPS FAILING (stand unreachable, out of reach) would retry a walk of up to 25 s every 30 s forever.
    if (status === 'success') { s.closeFails = 0; s.closeBackoffUntil = 0 } else if (status === 'failed' && !RUNNER_DECLINED.has(failClass)) {
      s.closeFails = (s.closeFails ?? 0) + 1
      if (s.closeFails >= CLOSE_FAILS_BEFORE_BACKOFF) { s.closeBackoffUntil = now + CLOSE_BACKOFF_MS; s.closeFails = 0 }
    }
    return s
  }
  if (!WELL_ORDERS.has(skill) || status === 'no_effect' || status === 'aborted' || RUNNER_DECLINED.has(failClass)) return s
  const key = skill === 'dispose_well' ? 'disposeBackoffUntil' : 'buildBackoffUntil'
  // room and someone-at-the-site are a matter of the next visit (a cooldown), not a fault (the long backoff)
  const backoff = skill === 'dispose_well' ? DISPOSE_BACKOFF_MS : ['well_no_room', 'well_attended'].includes(failClass) ? WELL_BUILD_COOLDOWN_MS : WELL_BUILD_BACKOFF_MS
  s[key] = status === 'success' ? 0 : now + backoff
  return s
}

// ---- every path keeps out of it -----------------------------------------------------------------------------------------

/** A step INTO the well column costs this: every profile's `cost > 100` guards delete the neighbour. */
export const WELL_STEP_COST = 1000
/** The column is closed from the shaft up this far, so a drop-down (maxDropDown <= 8) cannot land on the cap either:
 *  getMoveDropDown prices the cells it passes (blockC, blockD), never its landing (movements.js getLandingBlock). */
export const WELL_COLUMN_UP = 10

/**
 * exclusionAreasStep entry: the pathfinder hands a block; a cell in a well's column (g-1 .. g+WELL_COLUMN_UP) costs
 * WELL_STEP_COST, so no node of any profile ever stands on, in or above a well -- whether the trapdoor is open or not,
 * and whatever the goal. Hot path: `cols` is a small cached array (one entry per town), no allocation.
 */
export function wellStepCost (cols, block, skip = null) {
  const p = block?.position
  if (!p || !cols || !cols.length) return 0
  for (let i = 0; i < cols.length; i++) {
    const c = cols[i]
    if (p.x === c.x && p.z === c.z && p.y >= c.y - 1 && p.y <= c.y + WELL_COLUMN_UP) {
      // THE BOT'S OWN WELL (Claude review P2-1), cap level and BELOW only: a jump out of a deeper (breached-floor) shaft
      // checks its headroom in the column at cap level (Codex round 7). NEVER above the cap: a path planned from inside
      // went shaft -> beside -> onto the open cap (Codex round 5).
      if (c === skip && p.y <= c.y) continue
      return WELL_STEP_COST
    }
  }
  return 0
}

/** exclusionAreasBreak entry: the cap, shaft, floor, walls and the underground ring are never a path's (or gather's) dig. */
export function wellBreakCost (cols, block, skip = null) {
  const p = block?.position
  if (!p || !cols || !cols.length) return 0
  for (let i = 0; i < cols.length; i++) {
    const c = cols[i]
    if (c === skip) continue   // THE BOT'S OWN WELL (Claude review P2-1): a body inside digs out through a wall (the well is breached and rebuilt)
    if (Math.abs(p.x - c.x) <= UNDERGROUND_RING && Math.abs(p.z - c.z) <= UNDERGROUND_RING && p.y >= c.y - 3 && p.y <= c.y) return 100
  }
  return 0
}

/** The well whose shaft holds this item position (below the cap's top), or null. Pure. */
export function itemInWell (cols, pos) {
  if (!pos || !cols) return null
  for (const c of cols) if (Math.floor(pos.x) === c.x && Math.floor(pos.z) === c.z && pos.y < c.y + 0.5 && pos.y > c.y - 2.5) return c
  return null
}

/** The well this body's feet are INSIDE (below the rim), or null. Pure. */
export function bodyInWell (cols, feet) {
  if (!feet || !cols) return null
  for (const c of cols) if (Math.floor(feet.x) === c.x && Math.floor(feet.z) === c.z && feet.y < c.y + 0.75 && feet.y > c.y - 2.5) return c
  return null
}

/** Add every wooden trapdoor to a profile's blocksCantBreak (a type set: no hot-path cost). Returns the profile. */
export function protectWellBlocks (movements, registry) {
  if (!movements) return movements
  if (!(movements.blocksCantBreak instanceof Set)) movements.blocksCantBreak = new Set(movements.blocksCantBreak ?? [])
  for (const [name, b] of Object.entries(registry?.blocksByName ?? {})) if (WOODEN_TRAPDOOR.test(name) && b?.id != null) movements.blocksCantBreak.add(b.id)
  return movements
}

// ---- rows -------------------------------------------------------------------------------------------------------------

const list = items => Object.entries(items ?? {}).filter(([, c]) => c > 0).map(([k, c]) => `${k}:${c}`).join(',') || '-'

/**
 * THE _well_dispose ROW, key=value (the read parses fields, not prose); stop= before items= (the row is cut at 300).
 *   offlist    THROWN item entities whose item -- as the SERVER names it in the entity's metadata -- is NOT on the list
 *              (the read's C3 gate; Claude review P1-1: the old nonlisted= was 0 by construction). unnamed: no metadata seen
 *   n          listed items the SERVER's bag lost (resync before and after), never the number of clicks
 *   nonlisted  items NOT on the list in a slot this visit CLICKED (from the server's before-snapshot; must be 0)
 *   misses     our throws that did not land in the shaft; retaken: how many of those came back to the bag
 *   recollected  our throws this body collected back OUT OF the shaft (must be 0)
 *   cap_end    the cap as read back when the visit ended: closed | open (the read pairs a left-open row only with cap_end=closed)
 *   other_loss   every other non-listed decrease of the bag meanwhile (eating, planting): a diagnostic, never a throw
 */
export function wellDisposeDetail ({ slotsBefore, slotsAfter, items = {}, tossed = 0, misses = 0, retaken = 0, recollected = 0, nonlisted = 0, otherLoss = 0,
                                     source = 'local', closedOpen = false, stop = 'done', at = null, offlist = 0, offlistItems = {}, unnamed = 0, capEnd = null,
                                     stone = null } = {}) {
  const n = Object.values(items).reduce((a, b) => a + b, 0)
  // offlist= FIRST after slots (the read's C3 gate): thrown entities whose item, AS THE SERVER NAMES IT, is off the list
  return (`slots=${slotsBefore}->${slotsAfter} offlist=${offlist} offlist_items=${list(offlistItems)} unnamed=${unnamed} ` +
          `freed=${(slotsBefore ?? 0) - (slotsAfter ?? 0)} tossed=${tossed} n=${n} misses=${misses} ` +
          `retaken=${retaken} recollected=${recollected} nonlisted=${nonlisted} other_loss=${otherLoss} server=${source} closed_open=${closedOpen ? 1 : 0}` +
          `${stone != null ? ` stone=${stone}` : ''}` +
          `${capEnd ? ` cap_end=${capEnd}` : ''}` +
          `${at ? ` at=${at.x},${at.y},${at.z}` : ''} stop=${String(stop).replace(/\s+/g, '_').slice(0, 80)} items=${list(items)}`).slice(0, 300)
}
