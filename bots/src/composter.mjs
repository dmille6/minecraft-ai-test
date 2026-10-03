// INVENTORY HYGIENE, PHASE 2: a composter at town turns ballast into nothing (and a little bone meal).
//
// Measured (09-28..10-02, 80 bots): median 35 of 36 slots used, 25/80 bots completely full; a full bot's gather
// succeeds 4.8% against 52.2% with room; 9 of 12 ore-tunnel attempts on 10-02 were refused for a full bag. Inflow
// measured 10-03 (80 bots, 3 h): 1,614 junk items entered bags -- oak_sapling 693 (leaf drops while chopping, auto
// picked up), bamboo 557, leaf_litter 166, birch_sapling 74, apple 67 -- and bots hold 57-248 saplings while planting
// needs a handful. Phase 1 (hygiene.mjs) stopped bots WALKING to junk; it could not get rid of what they carry.
//
// WHY A COMPOSTER (agreed design, both engines, 09-30). Tossing is out: the server hands any item within ~1 block of
// a player back to that player after the 2 s pickup delay, and a pile anywhere is collected by the next bot that
// passes (owner, 09-29). A composter CONSUMES every item inserted at levels 0-6 -- the level only rises by chance --
// so nothing is left in the world except, every 7 levels, one bone meal, which is worth keeping.
//
// TWO DETERMINISTIC ORDERS, NEVER A TRIP, NEVER THE MODEL'S CHOICE (townOrder below decides both):
//   build_composter  at town, no composter around home, one wood held, and free slots for the WORST CASE of the
//                    whole craft chain -- crafted output with no slot is dropped by mineflayer, so it never crafts
//                    into a full bag. It places only at the town's CANONICAL site: a pure function of home and the
//                    world, so every bot computes the same cell and a town gets one composter.
//   compost          at town, bag at TRIGGER_SLOTS+, a composter around home. A full bag only starts a fill it can
//                    finish (the stack empties before level 7) so it can always take the bone meal out.

import fs from 'node:fs'
import path from 'node:path'
import { NEVER_KEEP, TRIGGER_SLOTS } from './hygiene.mjs'
import { chainPeak } from './craftroom.mjs'

/**
 * VERIFIED COMPOSTING CHANCES, Java 1.21.x -- the probability that ONE inserted item raises the level by one.
 * Source: the vanilla ComposterBlock.COMPOSTABLES table (`ComposterBlock.bootStrap`) as published on
 * https://minecraft.wiki/w/Composter (Java Edition table), read 2026-10-02/03: "Saplings" 30% (every sapling item),
 * Leaf Litter / seeds / Short Grass / Seagrass 30%, Tall Grass / Vines 50%, Fern / Large Fern / Flowers 65%.
 * minecraft-data 3.112.0 carries the block (state `level`, 0..8) and the recipe, but NOT this table.
 *
 * The allowlist IS the safety: a composter consumes whatever it is given. NOT compostable in Java, so absent on
 * purpose (same source: "it is not possible to compost bamboo, dead bushes..."; eggs, flint, ink sacs, dripstone and
 * rails are in no tier): egg, brown_egg, blue_egg, flint, ink_sac, glow_ink_sac, pointed_dripstone, dead_bush, rail,
 * bamboo. Apples ARE compostable (65%) and are kept: they are food.
 */
export const COMPOST_CHANCE = Object.freeze({
  leaf_litter: 0.3,
  wheat_seeds: 0.3, beetroot_seeds: 0.3, melon_seeds: 0.3, pumpkin_seeds: 0.3,
  poppy: 0.65, dandelion: 0.65,
  short_grass: 0.3, seagrass: 0.3, tall_grass: 0.5, fern: 0.65, large_fern: 0.65,
  vine: 0.5,
})
/** Every `_sapling` item in 1.21.11 (oak, spruce, birch, jungle, acacia, cherry, dark_oak, pale_oak): 30%. */
export const SAPLING_CHANCE = 0.3

/**
 * SAPLINGS KEPT PER SPECIES. Planting (workorder.mjs plantingOrder) plants only a species held ABOVE its own
 * PLANT_RESERVE (8), so composting down to 8 would switch planting off. Twice that leaves eight plantable above
 * planting's floor -- more than an hour of plants at one per ten minutes, and the bots pick up ~230 saplings an hour.
 */
export const SAPLING_RESERVE = 16

const isSapling = name => typeof name === 'string' && /_sapling$/.test(name)

/** leaf_litter first (it is the biggest occupant), then surplus saplings (the largest inflow), seeds, flowers, grass. */
const RANK = name => name === 'leaf_litter' ? 0 : isSapling(name) ? 1 : /_seeds$/.test(name) ? 2
  : /^(poppy|dandelion)$/.test(name) ? 3 : /(grass|fern)$/.test(name) ? 4 : 5

/** Never composted whatever a table says: food, tools, wood, ores, and the product itself. */
const NEVER_COMPOST = /(_propagule$|^apple$|^bone_meal$|_log$|_wood$|_planks$|_ore$|^raw_|_ingot$|_(pickaxe|axe|shovel|hoe|sword)$)/

/** Is this item ballast a composter may consume WHOLE? NEVER_KEEP (worth nothing to the fleet) AND verified compostable. */
export function isCompostJunk (name) {
  return typeof name === 'string' && NEVER_KEEP.has(name) && Object.hasOwn(COMPOST_CHANCE, name) && !NEVER_COMPOST.test(name)
}

/** Could this item have gone INTO the composter (the planner's inputs: junk, and saplings -- only ever above the reserve)? */
export const isCompostInput = name => isCompostJunk(name) || isSapling(name)

/** name -> how many of it may be composted from this bag: all of the junk, saplings only above SAPLING_RESERVE. */
export function compostAllowance (items = []) {
  const totals = {}
  for (const it of (Array.isArray(items) ? items : [])) {
    if (!it?.name || !(isCompostJunk(it.name) || isSapling(it.name))) continue
    totals[it.name] = (totals[it.name] ?? 0) + (it.count ?? 0)
  }
  const out = {}
  for (const [name, n] of Object.entries(totals)) {
    const a = isSapling(name) ? n - SAPLING_RESERVE : n
    if (a > 0) out[name] = a
  }
  return out
}

/** At most this many items per visit: ~21 leaf_litter fill a composter once, and every insert is a server round trip. */
export const MAX_ITEMS_PER_VISIT = 160
/** Wall clock for the composting loop itself, inside the skill contract and the runner's 180 s watchdog. */
export const VISIT_BUDGET_MS = 45_000

/**
 * compostPlan(items) -> { slots, junk, take: [{ name, count }] }  -- what could go, in planner order, capped.
 * Pure. `junk` is what the trigger counts.
 */
export function compostPlan (items = [], { maxItems = MAX_ITEMS_PER_VISIT } = {}) {
  const list = (Array.isArray(items) ? items : []).filter(it => it?.name)
  const allow = compostAllowance(list)
  const junk = Object.values(allow).reduce((a, b) => a + b, 0)
  let left = Math.max(0, maxItems)
  const take = []
  for (const name of Object.keys(allow).sort((a, b) => RANK(a) - RANK(b) || a.localeCompare(b))) {
    if (left <= 0) break
    const n = Math.min(left, allow[name])
    take.push({ name, count: n }); left -= n
  }
  return { slots: list.length, junk, take }
}

/**
 * WHICH STACK GOES IN NEXT -> { item, n } | null. Pure, recomputed after every insert (so a reserve can never be crossed).
 *   room   the bag can take a bone meal now (boneMealRoom)
 * With room: planner order (leaf_litter, surplus saplings, seeds, flowers, grass), the smallest stack of that kind.
 * Without room: the SMALLEST stack in the bag that can be emptied completely (a sapling stack only if the surplus
 * covers all of it), because only an emptied slot can take the bone meal at the end of the fill.
 * `n` is how many of that stack may go: the whole stack, or a sapling stack down to the reserve.
 */
export function nextInsert (items = [], { room = true } = {}) {
  const list = (Array.isArray(items) ? items : []).filter(it => it?.name && (it.count ?? 0) > 0)
  const allow = compostAllowance(list)
  const stacks = list.filter(it => (allow[it.name] ?? 0) > 0)
  if (!stacks.length) return null
  if (room) {
    const name = Object.keys(allow).sort((a, b) => RANK(a) - RANK(b) || a.localeCompare(b))[0]
    const item = stacks.filter(s => s.name === name).sort((a, b) => a.count - b.count || (b.slot ?? 0) - (a.slot ?? 0))[0]
    return { item, n: Math.min(item.count, allow[name]) }
  }
  const whole = stacks.filter(s => allow[s.name] >= s.count)
    .sort((a, b) => a.count - b.count || RANK(a.name) - RANK(b.name) || (b.slot ?? 0) - (a.slot ?? 0))
  return whole.length ? { item: whole[0], n: whole[0].count } : null
}

/** Can the bag take one bone meal right now: a free slot, or a bone_meal stack with room. */
export function boneMealRoom (items = []) {
  const list = (Array.isArray(items) ? items : []).filter(it => it?.name && (it.count ?? 0) > 0)
  return list.length < 36 || list.some(it => it.name === 'bone_meal' && it.count < 64)
}

/**
 * WHAT TO DO AT THE COMPOSTER NOW. Pure.
 *   level     0..8, or null (gone)
 *   room      boneMealRoom
 *   smallest  how many items the next insert stack holds (0 = nothing left to insert)
 * Inserting never fills a slot, so the only way a bot gets stuck is a ripe composter (8) and no room for its bone
 * meal. From level L at least 7 - L inserts are needed to reach 7 (every one could raise it), so a stack of at most
 * 7 - L items is guaranteed to have emptied its slot by the time the composter can ripen.
 */
export function fillDecision ({ level = null, room = false, smallest = 0 } = {}) {
  if (!Number.isInteger(level)) return 'gone'
  if (level === 8) return room ? 'harvest' : 'skip_no_room'
  if (level === 7) return room ? 'ripen' : 'skip_no_room'
  if (!(smallest > 0)) return 'done'
  if (room) return 'insert'
  return smallest <= 7 - level ? 'insert' : 'skip_no_room'
}

/** "At town": horizontally this close to home... */
export const TOWN_RADIUS = 48
/**
 * A composter is the TOWN'S only within this distance of home. The canonical site is always inside it (CANONICAL_RADIUS
 * 11 rings: at most 15.6 away), and a village composter 30 blocks off is not ours to fill or to count as "built".
 */
export const ADOPT_RADIUS = 16
/** ...and town storage (a chest/barrel) in sight this close. */
export const STORAGE_NEAR = 16

/** The composter's `level` state as a number 0..8 (prismarine-block returns it as a STRING), or null. */
export function composterLevel (block) {
  if (!block || block.name !== 'composter') return null
  try {
    const raw = block.getProperties?.()?.level
    const v = Number(raw)
    return raw !== undefined && raw !== null && raw !== '' && Number.isInteger(v) && v >= 0 && v <= 8 ? v : null
  } catch { return null }
}

// ---- building one ---------------------------------------------------------------------------------------------
//
// The recipe (minecraft-data 3.112.0, 1.21.11: 12 variants, one per wood, never mixed): 7 slabs of ONE wood in a U
//     S . S / S . S / S S S   -> 1 composter        (3x3: needs a crafting table)
// a slab is 3 planks in a row -> 6 slabs            (3 wide: needs a crafting table too)
// and a log is 4 planks (2x2, no table).

const WOODS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry', 'pale_oak', 'crimson', 'warped']
const logOf = w => (w === 'crimson' || w === 'warped') ? `${w}_stem` : `${w}_log`
export const SLABS_PER_COMPOSTER = 7
const SLABS_PER_CRAFT = 6, PLANKS_PER_SLAB_CRAFT = 3, PLANKS_PER_LOG = 4, PLANKS_PER_TABLE = 4

/**
 * composterBuildPlan(counts, { tableAvailable }) -> null | { carried, slotsNeeded } | { wood, log, logCrafts, slabCrafts, needTable, slotsNeeded }
 *   counts          name -> count held
 *   tableAvailable  a crafting table is carried or already placed within craft's 32-block search
 * The cheapest single-wood route to one composter from what is HELD -- never a gather. Null when nothing held makes
 * one; the remedy (3 logs of one wood, 2 with a table at hand) is a gather the model can choose anywhere.
 * Crafts are counted in OPERATIONS, which is what craft()'s `count` means (bot.craft(recipe, count) runs it count times).
 *
 * slotsNeeded: the free slots the chain needs. Given the bag's STACKS (`items`), it is SIMULATED (chainSteps + craftroom's
 * chainPeak): each step in order -- planks, the table crafted and put down, slabs, the composter -- from the bag the
 * previous step left, so a stack the chain empties counts (36/36 holding 7 slabs and a carried table needs none). With
 * counts only it is the WORST CASE: no partial stack absorbs anything and no ingredient slot empties. A bag with
 * fewer free slots must not start: mineflayer's putAway DROPS crafted output it cannot store.
 */
export function composterBuildPlan (counts = {}, { tableAvailable = false, items = null } = {}) {
  if ((counts.composter ?? 0) > 0) return { carried: true, slotsNeeded: 0 }
  let best = null
  for (const wood of WOODS) {
    const slabs = counts[`${wood}_slab`] ?? 0, planks = counts[`${wood}_planks`] ?? 0, logs = counts[logOf(wood)] ?? 0
    const slabCrafts = Math.ceil(Math.max(0, SLABS_PER_COMPOSTER - slabs) / SLABS_PER_CRAFT)
    const planksNeeded = slabCrafts * PLANKS_PER_SLAB_CRAFT + (tableAvailable ? 0 : PLANKS_PER_TABLE)
    const logCrafts = Math.ceil(Math.max(0, planksNeeded - planks) / PLANKS_PER_LOG)
    if (logCrafts > logs) continue
    const slotsNeeded = Math.ceil(logCrafts * PLANKS_PER_LOG / 64) + (tableAvailable ? 0 : 1) +
                        Math.ceil(slabCrafts * SLABS_PER_CRAFT / 64) + 1
    const cost = logCrafts * 10 + slabCrafts
    if (!best || cost < best.cost) best = { wood, log: logOf(wood), logCrafts, slabCrafts, needTable: !tableAvailable, slotsNeeded, cost }
  }
  if (!best) return null
  const { cost, ...plan } = best
  if (Array.isArray(items)) {
    const sim = chainPeak(items, chainSteps(plan))
    if (sim.ok) return { ...plan, slotsNeeded: sim.slotsNeeded, simulated: true }
  }
  return plan
}

/**
 * THE BUILD'S CRAFTS AS craftroom STEPS, in the order build_composter runs them. Pure. A table is crafted and PUT
 * DOWN when the plan needs one (a carried table may or may not be put down at the site: not counted as freeing).
 */
export function chainSteps (plan) {
  if (!plan || plan.carried) return []
  const r = (consumes, outputs) => ({ consumes, outputs: outputs.map(([name, count]) => ({ name, count, stackSize: 64 })) })
  const planks = `${plan.wood}_planks`, slab = `${plan.wood}_slab`
  const steps = []
  if (plan.logCrafts) steps.push({ recipe: r([{ name: plan.log, count: 1 }], [[planks, PLANKS_PER_LOG]]), times: plan.logCrafts })
  if (plan.needTable) {
    steps.push({ recipe: r([{ name: planks, count: PLANKS_PER_TABLE }], [['crafting_table', 1]]), times: 1 })
    steps.push({ recipe: r([{ name: 'crafting_table', count: 1 }], []), times: 1 })   // put down at the site
  }
  if (plan.slabCrafts) steps.push({ recipe: r([{ name: planks, count: PLANKS_PER_SLAB_CRAFT }], [[slab, SLABS_PER_CRAFT]]), times: plan.slabCrafts })
  steps.push({ recipe: r([{ name: slab, count: SLABS_PER_COMPOSTER }], [['composter', 1]]), times: 1 })
  return steps
}

/** Defer to a lower-named bot at town at most this many visits, then build anyway (no starvation). */
export const BUILDER_MAX_DEFERRALS = 3

/**
 * ONE BUILDER PER TOWN, WITHOUT A SERVER. Pure. The lowest name at town builds; a bot that sees a lower name defers,
 * at most BUILDER_MAX_DEFERRALS visits. The authoritative guards are the canonical site (every bot places on the same
 * cell) and the re-check for a composter around home immediately before the composter craft and before placing.
 */
export function builderDecision ({ myName = '', peers = [], deferrals = 0 } = {}) {
  const lower = (Array.isArray(peers) ? peers : []).filter(n => typeof n === 'string' && n && n !== myName && n < myName).sort()
  if (lower.length && deferrals < BUILDER_MAX_DEFERRALS) return { build: false, defer: true, to: lower[0] }
  return { build: true, defer: false, to: null }
}

// ---- where it goes: the town's canonical site ------------------------------------------------------------------

/** A chest lid must still open, a hopper must not pull the bone meal, a furnace front stays reachable. */
export const MIN_CONTAINER_DISTANCE = 3
/** Stay off the home point: every bot's `home` walk ends within 2 blocks of it. */
export const HOME_CLEARANCE = 3
/** Rings searched around home for the canonical site (kept inside ADOPT_RADIUS even on the diagonal). */
export const CANONICAL_RADIUS = 11
const COLUMN_UP = 8, COLUMN_DOWN = 8
/**
 * THE ONE DISTANCE: block coordinates, 3-D Euclidean from home -- exactly what mineflayer's findBlocks compares against
 * maxDistance (cursor.distanceTo(point)). Site selection and composter discovery both use it, so a site that is chosen
 * is a site that is found (11 rings and 8 blocks up would otherwise reach ~17.5 from home, past a 16-block search).
 */
export const townDistance = (home, p) => Math.hypot(p.x - home.x, p.y - Math.floor(home.y ?? p.y), p.z - home.z)
/** Every block that is a container or feeds/pulls one. Matched by NAME over the whole clearance volume, uncapped. */
export const CLEARANCE_CONTAINER = /^(chest|trapped_chest|ender_chest|barrel|hopper|dropper|dispenser|furnace|blast_furnace|smoker|brewing_stand|(\w+_)?shulker_box)$/
const PLACEABLE_INTO = new Set(['air', 'cave_air', 'short_grass', 'fern', 'dead_bush'])
const LIQUID = /^(water|lava|flowing_water|flowing_lava|bubble_column)$/
const FLOOR_NO = /(^chest$|^trapped_chest$|^barrel$|^composter$|^crafting_table$|furnace$|^smoker$|_leaves$|^dirt_path$|^farmland$|_slab$|_stairs$|_door$|_trapdoor$|^scaffolding$|^ice$|shulker_box$|^hopper$)/

const solidAt = b => !!b && b.boundingBox === 'block'
const passable = b => !!b && b.boundingBox === 'empty' && !LIQUID.test(b.name ?? '')

/**
 * IS THIS SOLID BLOCK ONE WIDE along either axis? -> true | false | null (unknown). A pillar top (one wide both ways) or
 * a wall top (one wide one way): a cell on it cannot be walked up to and stood beside, so nothing on it is reachable.
 */
export function narrowTop (read, x, y, z) {
  const xs = [read(x + 1, y, z), read(x - 1, y, z)], zs = [read(x, y, z + 1), read(x, y, z - 1)]
  if ([...xs, ...zs].some(b => !b)) return null
  return (!solidAt(xs[0]) && !solidAt(xs[1])) || (!solidAt(zs[0]) && !solidAt(zs[1]))
}

/**
 * WHERE A BOT STANDS TO USE THE SITE -> {x,y,z} | null. Pure. A cardinal neighbour at the site's own level with air
 * (not liquid) at feet and head over a solid floor that is not itself a one-wide top. Fixed order: +x, -x, +z, -z.
 */
export function standableBeside (read, site) {
  if (typeof read !== 'function' || !site) return null
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const x = site.x + dx, z = site.z + dz, y = site.y
    const feet = read(x, y, z), head = read(x, y + 1, z), floor = read(x, y - 1, z)
    if (!passable(feet) || !passable(head) || !solidAt(floor)) continue
    if (narrowTop(read, x, y - 1, z) !== false) continue
    return { x, y, z }
  }
  return null
}

/**
 * WHY THIS CELL CANNOT HOLD THE TOWN COMPOSTER -> a reason string, or null when it can. Pure.
 *   read  (x,y,z) -> { name, boundingBox } | null   (null = unknown: never on a guess)
 * The cell is replaceable on a solid full floor that is not a container, station, path or slab; no liquid beside it;
 * not a corridor/doorway (solid on both sides along either axis); no door or gate within 2; off the home point; and
 * NO container of any kind anywhere in the clearance volume (every cell within MIN_CONTAINER_DISTANCE, read one by
 * one -- there is no list and no count cap to run out). Called for the canonical search AND again right before placing.
 */
export function siteRefusal (read, site, home = null) {
  if (typeof read !== 'function' || !site) return 'no site'
  const { x, y, z } = site
  const solid = b => !!b && b.boundingBox === 'block'
  if (home && Math.hypot(x - home.x, z - home.z) < HOME_CLEARANCE) return 'home point'
  const cell = read(x, y, z), floor = read(x, y - 1, z)
  if (!cell || !floor) return 'unknown'
  if (!PLACEABLE_INTO.has(cell.name)) return `cell is ${cell.name}`
  if (!solid(floor) || FLOOR_NO.test(floor.name ?? '')) return `floor is ${floor.name}`
  const narrow = narrowTop(read, x, y - 1, z)
  if (narrow === null) return 'unknown'
  if (narrow) return 'one-wide column top'
  const sides = [read(x + 1, y, z), read(x - 1, y, z), read(x, y, z + 1), read(x, y, z - 1)]
  if (sides.some(b => !b)) return 'unknown'
  if (sides.some(b => LIQUID.test(b.name ?? ''))) return 'liquid beside'
  if ((solid(sides[0]) && solid(sides[1])) || (solid(sides[2]) && solid(sides[3]))) return 'corridor'
  const R = MIN_CONTAINER_DISTANCE
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      for (let dy = -2; dy <= 2; dy++) {
        const near = Math.hypot(dx, dy, dz)
        const door = Math.max(Math.abs(dx), Math.abs(dz)) <= 2 && dy >= 0 && dy <= 1
        if (near >= R && !door) continue
        const b = read(x + dx, y + dy, z + dz)
        if (!b) return 'unknown'
        if (near < R && CLEARANCE_CONTAINER.test(b.name ?? '')) return `${b.name} within ${MIN_CONTAINER_DISTANCE}`
        if (door && /_door$|_gate$/.test(b.name ?? '')) return 'door'
      }
    }
  }
  // REACHABLE: somewhere beside it, at its level, a bot can stand to use it. Otherwise every bot computes the same
  // unreachable cell forever.
  if (!standableBeside(read, site)) return 'nowhere to stand beside it'
  return null
}

/** The fixed spiral: rings HOME_CLEARANCE..CANONICAL_RADIUS around home, each ring in angle order from east. */
function spiral (home) {
  const out = []
  for (let r = HOME_CLEARANCE; r <= CANONICAL_RADIUS; r++) {
    const ring = []
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) if (Math.max(Math.abs(dx), Math.abs(dz)) === r) ring.push([dx, dz])
    ring.sort((a, b) => Math.atan2(a[1], a[0]) - Math.atan2(b[1], b[0]) || a[0] - b[0] || a[1] - b[1])
    for (const [dx, dz] of ring) out.push({ x: home.x + dx, z: home.z + dz })
  }
  return out
}

/**
 * THE TOWN'S COMPOSTER CELL -> { site, why }. Pure: a function of home and the world only, so every bot that reads
 * the same world gets the same cell, wherever it stands. Walks the fixed spiral; in each column the surface cell is
 * the highest replaceable cell on a solid floor between home.y+8 and home.y-8; the first column whose surface passes
 * siteRefusal wins. Any UNKNOWN read on the way returns no site (an unloaded chunk must not make two bots disagree).
 */
export function canonicalComposterSite ({ home, read } = {}) {
  if (!home || typeof read !== 'function') return { site: null, why: 'no home' }
  const hy = Math.floor(home.y ?? 64)
  for (const { x, z } of spiral(home)) {
    let surface = null
    for (let y = hy + COLUMN_UP; y >= hy - COLUMN_DOWN; y--) {
      const cell = read(x, y, z), floor = read(x, y - 1, z)
      if (!cell || !floor) return { site: null, why: `unknown cell at ${x},${y},${z}` }
      if (PLACEABLE_INTO.has(cell.name) && floor.boundingBox === 'block') { surface = { x, y, z }; break }
    }
    if (!surface) continue
    if (townDistance(home, surface) > ADOPT_RADIUS) continue
    const why = siteRefusal(read, surface, home)
    if (why === 'unknown') return { site: null, why: `unknown cell near ${x},${surface.y},${z}` }
    if (!why) return { site: surface, why: null }
  }
  return { site: null, why: `no valid cell within ${CANONICAL_RADIUS} of home` }
}

/**
 * ONE SITE PER TOWN, STICKY, SHARED -- AND REPLACEABLE WHEN IT GOES BAD.
 *
 * The spiral's answer moves as obstructions come and go, so the first bot to compute a site records it in the pool
 * state dir and every later bot targets that cell even if an earlier spiral cell becomes valid. SHARING IS BY DISK: all
 * bots of a pool run on one host today, so they share the pool state dir; a pool split across hosts would get one
 * record per host, and only the "a composter within ADOPT_RADIUS of home wins" re-scan would join them.
 *
 * The record is a GENERATION: `<key>.g<N>.json`, the highest N is current. A generation is created with a temp file
 * and link(), which fails if that generation exists, so for any N exactly one writer wins and the rest adopt it --
 * compare-and-swap without a lock. A bot whose view REFUSES the current site (a sapling grew into a tree, a chest went
 * in beside it, scaffold dirt) creates N+1 from its own canonical answer; a bot that loses that race adopts the winner.
 * A record from ANOTHER WORLD (a reseed keeps pool and home) counts as absent. Nothing is ever deleted.
 *
 * FAILS CLOSED: if no record can be read or established (unwritable dir, no hard links), there is no site and the
 * build waits -- a bot never builds on its private answer.
 */
const GEN = key => new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.g(\\d+)\\.json$`)
const genFile = (dir, key, n) => path.join(dir, `${key}.g${n}.json`)
const validSite = r => !!r && [r.x, r.y, r.z].every(Number.isInteger)
/** Two world ids are the same world unless both are known and differ (an unknown id never invalidates a record). */
export const sameWorld = (a, b) => !a || !b || String(a) === String(b)

/** The current record -> { gen, site, world, malformed }. gen 0 = no record at all. */
export function readTownSite (dir, key) {
  let gen = 0
  try {
    const re = GEN(key)
    for (const f of fs.readdirSync(dir)) { const m = re.exec(f); if (m) gen = Math.max(gen, Number(m[1])) }
  } catch { return { gen: 0, site: null, world: null, malformed: false } }
  if (!gen) return { gen: 0, site: null, world: null, malformed: false }
  try {
    const r = JSON.parse(fs.readFileSync(genFile(dir, key, gen), 'utf8'))
    if (!validSite(r)) return { gen, site: null, world: null, malformed: true }
    return { gen, site: { x: r.x, y: r.y, z: r.z }, world: r.world ?? null, malformed: false }
  } catch { return { gen, site: null, world: null, malformed: true } }
}

/** Create generation `gen` -> true if THIS call created it; false if it exists or nothing could be written. */
export function createSiteGen (dir, key, gen, site, world = null) {
  const file = genFile(dir, key, gen)
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(tmp, JSON.stringify({ x: site.x, y: site.y, z: site.z, world: world || null, at: new Date().toISOString() }))
    fs.linkSync(tmp, file)
    pruneSiteGens(dir, key, gen)
    return true
  } catch {
    return false
  } finally {
    try { fs.unlinkSync(tmp) } catch { /* never written */ }
  }
}

/** Keep the current generation and the two before it; older records are history nobody reads. Best effort. */
function pruneSiteGens (dir, key, gen) {
  try {
    const re = GEN(key)
    for (const f of fs.readdirSync(dir)) {
      const m = re.exec(f)
      if (m && Number(m[1]) < gen - 2) { try { fs.unlinkSync(path.join(dir, f)) } catch { /* another bot pruned it */ } }
    }
  } catch { /* unreadable dir: nothing to prune */ }
}

/**
 * THE TOWN'S SITE -> { site, gen, why, defer, replaced }. `gen` is the generation the site came from: a builder FENCES
 * on it (re-reads the record immediately before placing and stands down if the generation moved).
 *   compute  () -> { site, why }   this bot's canonical answer (only evaluated when a new generation is needed)
 *   refuse   (site) -> reason|null  siteRefusal in this bot's view
 * 'unknown' (an unloaded cell) is a deferral, never a reason to replace.
 */
export function resolveTownSite ({ dir, key, world = null, compute, refuse }) {
  const cur = readTownSite(dir, key)
  if (cur.site && sameWorld(cur.world, world)) {
    const why = refuse(cur.site)
    if (!why) return { site: cur.site, gen: cur.gen, why: null, defer: false, replaced: null }
    if (why === 'unknown') return { site: null, why: 'unknown cell around the town\'s composter site', defer: true, replaced: null }
  }
  const next = compute()
  if (!next?.site) return { site: null, why: next?.why ?? 'no canonical site', defer: true, replaced: null }
  if (createSiteGen(dir, key, cur.gen + 1, next.site, world)) return { site: next.site, gen: cur.gen + 1, why: null, defer: false, replaced: cur.site }
  const won = readTownSite(dir, key)
  if (won.gen > cur.gen && won.site && sameWorld(won.world, world)) {
    // THE WINNER'S SITE IS VALIDATED IN THIS BOT'S VIEW before anything is crafted for it. Unknown: wait. Refused:
    // wait too -- the next visit sees it as the current record and replaces it by the generation rules.
    const why = refuse(won.site)
    if (!why) return { site: won.site, gen: won.gen, why: null, defer: false, replaced: cur.site }
    return { site: null, why: `the site another bot just recorded is ${why === 'unknown' ? 'not loaded here' : `refused here (${why})`}`, defer: true, replaced: null }
  }
  return { site: null, why: 'the shared site record could not be written or read', defer: true, replaced: null }
}

/** The world's identity from the login packet (SpawnInfo.hashedSeed, an i64): a reseed changes it. '' if absent. */
export function worldIdFromLogin (packet) {
  const h = packet?.worldState?.hashedSeed ?? packet?.hashedSeed
  if (h === undefined || h === null) return ''
  if (Array.isArray(h)) return h.map(String).join(':')
  return String(h)
}

/** The plan may count on a table only if one is CARRIED: a placed one may be out of reach of the site. */
export const townPlanTableAvailable = (items = []) => (Array.isArray(items) ? items : []).some(it => it?.name === 'crafting_table' && (it.count ?? 0) > 0)

/**
 * WHERE THE BUILDER PUTS ITS CRAFTING TABLE -> {x,y,z} | null. Pure. Within 2 of where it stands (so it can craft
 * without walking), at its own level, replaceable on a solid floor -- and never on the site or any cell touching it
 * (Chebyshev >= 2): a table beside the site could turn it into a corridor or take the only standing cell.
 * `bodies` ({ x, y, z, w, h }: feet centre, width, height) -- the bot's own included -- are never placed into: a cell
 * one intersects cannot take a block (sandbox: an off-centre bot overlapped 699,120,699 and the placement timed out).
 */
export function bodyInCell (b, c) {
  const hw = (Number(b?.w) || 0.6) / 2, h = Number(b?.h) || 1.8
  return b?.x + hw > c.x && b.x - hw < c.x + 1 && b.z + hw > c.z && b.z - hw < c.z + 1 && b.y + h > c.y && b.y < c.y + 1
}
export function tableCellFor ({ site, stand, read, bodies = [] } = {}) {
  if (!site || !stand || typeof read !== 'function') return null
  const out = []
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      const x = stand.x + dx, z = stand.z + dz, y = stand.y
      if (dx === 0 && dz === 0) continue
      if (Math.max(Math.abs(x - site.x), Math.abs(z - site.z)) < 2) continue
      const cell = read(x, y, z), head = read(x, y + 1, z), floor = read(x, y - 1, z)
      if (!cell || !PLACEABLE_INTO.has(cell.name) || !solidAt(floor) || !head) continue
      if ((bodies ?? []).some(b => bodyInCell(b, { x, y, z }))) continue
      out.push({ x, y, z, d: Math.abs(dx) + Math.abs(dz) })
    }
  }
  out.sort((a, b) => a.d - b.d || a.x - b.x || a.z - b.z)
  return out[0] ? { x: out[0].x, y: out[0].y, z: out[0].z } : null
}

// ---- the scheduler ------------------------------------------------------------------------------------------------

export const COMPOST_COOLDOWN_MS = 3 * 60 * 1000
export const COMPOST_BACKOFF_MS = 15 * 60 * 1000
export const BUILD_COOLDOWN_MS = 5 * 60 * 1000
export const BUILD_BACKOFF_MS = 30 * 60 * 1000
/** A build refused for room (the bag-full family) backs off only a cooldown: room is a matter of the next visit's bag. */
export const BUILD_NO_ROOM_BACKOFF_MS = BUILD_COOLDOWN_MS
/** World scans (storage, composter, table) at most this often per bot, however often it decides. */
export const TOWN_SCAN_MS = 30 * 1000
export const TOWN_ORDERS = new Set(['compost', 'build_composter'])

const lazy = v => (typeof v === 'function' ? v() : v)

/**
 * THE TOWN WORK ORDER -> { order, state }. Pure; cognitive.mjs supplies the readings and keeps `state`.
 *   slots, freeSlots, junk (compostPlan), distHome   cheap, evaluated first
 *   storageNear, composterAtTown, buildPlan, peers   world scans: values or functions, evaluated lazily and at most
 *                                                    once per TOWN_SCAN_MS
 *   state  { lastScanAt, lastCompostAt, compostBackoffUntil, lastBuildAt, buildBackoffUntil, deferrals }
 * Compost: at town, >= TRIGGER_SLOTS, junk, a composter around home. Build: at town, NO composter around home, a plan
 * from wood held, and freeSlots >= plan.slotsNeeded -- independent of the compost threshold. Cooldowns are charged
 * when an order is ISSUED (and a deferral counts as a visit).
 */
export function townOrder ({ now = 0, slots = 0, freeSlots = 0, junk = 0, distHome = Infinity, storageNear = false,
                             composterAtTown = false, buildPlan = null, myName = '', peers = [], state = {},
                             room = false, composterRipe = false } = {}) {
  const s = { ...state }
  const none = () => ({ order: null, state: s })
  if (!(distHome <= TOWN_RADIUS)) return none()
  const cooled = now - (s.lastCompostAt ?? -Infinity) >= COMPOST_COOLDOWN_MS && now >= (s.compostBackoffUntil ?? 0)
  const compostReady = cooled && slots >= TRIGGER_SLOTS && junk > 0
  // ANY bot at town with room may empty a ripe composter -- a full one cannot, and it would wait for a 34-slot bot.
  const harvestReady = cooled && !!room
  const buildReady = now - (s.lastBuildAt ?? -Infinity) >= BUILD_COOLDOWN_MS && now >= (s.buildBackoffUntil ?? 0)
  if (!compostReady && !harvestReady && !buildReady) return none()
  if (now - (s.lastScanAt ?? -Infinity) < TOWN_SCAN_MS) return none()
  s.lastScanAt = now
  if (!lazy(storageNear)) return none()
  if (lazy(composterAtTown)) {
    if (compostReady) {
      s.lastCompostAt = now
      return { order: { skill: 'compost', args: {}, why: `at town with ${slots} of 36 slots used; ${junk} compostable item(s)` }, state: s }
    }
    if (harvestReady && lazy(composterRipe)) {
      s.lastCompostAt = now
      return { order: { skill: 'compost', args: {}, why: 'at town with room, and the town composter is ripe: take the bone meal out' }, state: s }
    }
    return none()
  }
  if (!buildReady) return none()
  const plan = lazy(buildPlan)
  if (!plan) return none()
  if (freeSlots < plan.slotsNeeded) return none()
  s.lastBuildAt = now
  const who = builderDecision({ myName, peers: lazy(peers) ?? [], deferrals: s.deferrals ?? 0 })
  if (who.defer) { s.deferrals = (s.deferrals ?? 0) + 1; return none() }
  s.deferrals = 0
  return { order: { skill: 'build_composter', args: {}, why: `at town, no composter, ${plan.carried ? 'carrying one' : `holding ${plan.wood} wood`} and ${freeSlots} free slots` }, state: s }
}

/** The runner declined to start the order (it never ran): a free skip, like no_effect. */
export const RUNNER_DECLINED = new Set(['runner_paused', 'runner_busy', 'body_held'])

/** After a town order ran -> the new state. A skip (no_effect), an interruption, or a runner refusal costs nothing; a fault backs off. */
export function townOrderOutcome (skill, status, now = 0, state = {}, failClass = null) {
  const s = { ...state }
  if (!TOWN_ORDERS.has(skill) || status === 'no_effect' || status === 'aborted' || RUNNER_DECLINED.has(failClass)) return s
  const key = skill === 'compost' ? 'compostBackoffUntil' : 'buildBackoffUntil'
  const backoff = skill === 'compost' ? COMPOST_BACKOFF_MS : failClass === 'composter_no_room' ? BUILD_NO_ROOM_BACKOFF_MS : BUILD_BACKOFF_MS
  s[key] = status === 'success' ? 0 : now + backoff
  return s
}

// ---- the hand -------------------------------------------------------------------------------------------------------

const TOOLISH = /(_(pickaxe|axe|shovel|hoe|sword)$|^(cobblestone|cobbled_deepslate|stone|dirt|stick|coal|torch|bone_meal)$)/
const compostish = name => isCompostJunk(name) || isSapling(name) || /^(apple|.*_seeds|.*_leaves)$/.test(name ?? '')
const same = (a, b) => !!a && !!b && a.name === b.name && (a.used ?? 0) === (b.used ?? 0)

/**
 * WHAT TO DO WITH THE HAND -> { action: 'none' | 'select' (index) | 'equip' (item) | 'leave' }. Pure.
 *   was     { name, used } held when the order began, or null (empty hand)
 *   held    { name, used } held now, or null
 *   hotbar  9 entries { name, used } | null, index = quickbar slot
 *   items   inventory items ({ name, durabilityUsed, slot }) for an equip from the main bag
 *   mode    'restore' (end of the order) | 'harvest' (at a ripe composter: never a compostable in hand)
 * Selecting a hotbar slot moves nothing; equip SWAPS (mineflayer moveSlotItem) and never tosses. There is no unequip:
 * with a full bag mineflayer's unequip has nowhere to put the item and tosses it. An empty starting hand is restored
 * by selecting an EMPTY hotbar slot -- never the old index, which may now hold the junk equip swapped into it.
 */
export function handPlan ({ was = null, held = null, hotbar = [], items = [], mode = 'restore' } = {}) {
  const hb = Array.from({ length: 9 }, (_, i) => hotbar[i] ?? null)
  const toWas = () => {
    if (same(held, was)) return { action: 'none' }
    let i = hb.findIndex(h => same(h, was)); if (i < 0) i = hb.findIndex(h => h?.name === was.name)
    if (i >= 0) return { action: 'select', index: i }
    const list = Array.isArray(items) ? items : []
    const item = list.find(it => it?.name === was.name && (it.durabilityUsed ?? 0) === (was.used ?? 0) && !(it.slot >= 36)) ??
                 list.find(it => it?.name === was.name && !(it.slot >= 36))
    return item ? { action: 'equip', item } : null
  }
  if (mode === 'harvest') {
    if (!held || !compostish(held.name)) return { action: 'none' }
    if (was && !compostish(was.name)) { const r = toWas(); if (r) return r }
    let i = hb.findIndex(h => !h); if (i >= 0) return { action: 'select', index: i }
    i = hb.findIndex(h => h && TOOLISH.test(h.name)); if (i >= 0) return { action: 'select', index: i }
    const item = (Array.isArray(items) ? items : []).find(it => it && TOOLISH.test(it.name) && !(it.slot >= 36))
    return item ? { action: 'equip', item } : { action: 'leave' }
  }
  if (was) return toWas() ?? { action: 'leave' }
  if (!held) return { action: 'none' }
  const i = hb.findIndex(h => !h)
  return i >= 0 ? { action: 'select', index: i } : { action: 'leave' }
}

// ---- the composter is never dug by a path ----------------------------------------------------------------------------

/**
 * Add the composter to a movement profile's blocksCantBreak (mineflayer-pathfinder already lists chest). Called on the
 * BASE profile before any clone: index.mjs clones with Object.assign, which copies the Set by reference, so every
 * dig-enabled profile (gather, ascent, descent, water, tunnel, collectblock's) refuses it. Returns the profile.
 */
export function protectTownBlocks (movements, registry) {
  if (!movements) return movements
  if (!(movements.blocksCantBreak instanceof Set)) movements.blocksCantBreak = new Set(movements.blocksCantBreak ?? [])
  const id = registry?.blocksByName?.composter?.id
  if (id != null) movements.blocksCantBreak.add(id)
  return movements
}

/**
 * NO PATH NODE STANDS ON A COMPOSTER (sandbox, Paper 1.21.8: 5 of 6 compost visits left the bone meal in the world).
 * Its cell is never a node -- its boundingBox is 'block' -- but the cell ABOVE it is: the floor reads `physical`, so a
 * walk or a jump-up lands on the top (mineflayer-pathfinder 2.4.5 getMoveJumpUp emits it), and the body falls into the
 * hollow at y + 0.125. An exclusionAreasStep entry: the pathfinder hands it the destination's cells, and a cell whose
 * floor is a composter costs COMPOSTER_TOP_COST, past the `cost > 100` that deletes the move. `blockAt(pos)` is the
 * bot's (extraInfos off: hot path); index.mjs puts it into EACH profile's own array.
 */
export const COMPOSTER_TOP_COST = 101
export function composterTopStep (blockAt, registry) {
  const id = registry?.blocksByName?.composter?.id
  return block => {
    const p = block?.position
    if (id == null || !p) return 0
    let below = null
    try { below = blockAt(p.offset(0, -1, 0)) } catch { below = null }
    return below?.type === id ? COMPOSTER_TOP_COST : 0
  }
}

/**
 * THE ROW A CANARY READ COUNTS. One line, key=value, so a read needs no prose parsing:
 *   slots=36->33 level=0->4 bonemeal=1 n=67 stop=done items=leaf_litter:64,wheat_seeds:3
 * `n` is the VERIFIED count (inventory fell by that much at the composter), never the number of clicks.
 */
export function compostDetail ({ slotsBefore, slotsAfter, levelBefore, levelAfter, bonemeal = 0, items = {}, stop = 'done', built = null } = {}) {
  const n = Object.values(items).reduce((a, b) => a + b, 0)
  const list = Object.entries(items).filter(([, c]) => c > 0).map(([k, c]) => `${k}:${c}`).join(',') || '-'
  // stop= BEFORE items=: the row is cut at 300 characters and a long item list must not cut the reason off.
  return (`slots=${slotsBefore}->${slotsAfter} level=${levelBefore ?? '?'}->${levelAfter ?? '?'} bonemeal=${bonemeal} n=${n}` +
          `${built ? ` built=${built}` : ''} stop=${String(stop).replace(/\s+/g, '_').slice(0, 80)} items=${list}`).slice(0, 300)
}
