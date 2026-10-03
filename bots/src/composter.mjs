// INVENTORY HYGIENE, PHASE 2: a composter at town turns ballast into nothing (and a little bone meal).
//
// Measured (09-28..10-02, 80 bots): median 35 of 36 slots used, 25/80 bots completely full; a full bot's gather
// succeeds 4.8% against 52.2% with room; 9 of 12 ore-tunnel attempts on 10-02 were refused for a full bag. The
// occupants are leaf_litter (54-454 per bot, up to 8 slots), wheat_seeds, flowers, grass. Phase 1 (hygiene.mjs)
// stopped bots WALKING to that junk; it could not get rid of what they already carry, and the bank chests are full.
//
// WHY A COMPOSTER (agreed design, both engines, 09-30). Tossing is out: the server hands any item within ~1 block of
// a player back to that player after the 2 s pickup delay, and a pile anywhere is collected by the next bot that
// passes (owner, 09-29). A composter CONSUMES every item inserted at levels 0-6 -- the level only rises by chance --
// so nothing is left in the world except, every 7 levels, one bone meal, which is worth keeping.
//
// DETERMINISTIC, NEVER A TRIP. A work order (cognitive.mjs) runs it only when the bot is ALREADY at town (near home
// and within sight of town storage) with a bag at TRIGGER_SLOTS or more. It is never offered to the model.
//
// Everything that decides is here and pure; skills.mjs `compost` only reads the world and acts.

import { NEVER_KEEP, TRIGGER_SLOTS } from './hygiene.mjs'

/**
 * VERIFIED COMPOSTING CHANCES, Java 1.21.x -- the probability that ONE inserted item raises the level by one.
 * Source: the vanilla ComposterBlock.COMPOSTABLES table (`ComposterBlock.bootStrap`) as published on
 * https://minecraft.wiki/w/Composter (Java Edition table), read 2026-10-02. minecraft-data 3.112.0 carries the block
 * (state `level`, 0..8) and the recipe, but NOT this table.
 *
 * Only NEVER_KEEP ballast is listed: a composter consumes whatever it is given, so the allowlist IS the safety.
 * NOT compostable in Java, so absent on purpose (same source: "it is not possible to compost bamboo, dead bushes...";
 * eggs, flint, ink sacs, dripstone and rails are in no tier): egg, brown_egg, blue_egg, flint, ink_sac,
 * glow_ink_sac, pointed_dripstone, dead_bush, rail, bamboo.
 */
export const COMPOST_CHANCE = Object.freeze({
  leaf_litter: 0.3,
  wheat_seeds: 0.3, beetroot_seeds: 0.3, melon_seeds: 0.3, pumpkin_seeds: 0.3,
  poppy: 0.65, dandelion: 0.65,
  short_grass: 0.3, seagrass: 0.3, tall_grass: 0.5, fern: 0.65, large_fern: 0.65,
  vine: 0.5,
})

/** leaf_litter first (it is the biggest occupant), then seeds, flowers, grass, then anything else listed. */
const RANK = name => name === 'leaf_litter' ? 0 : /_seeds$/.test(name) ? 1 : /^(poppy|dandelion)$/.test(name) ? 2
  : /(grass|fern)$/.test(name) ? 3 : 4

/** Never composted whatever a table says: planting stock, food, tools, wood, ores, and the product itself. */
const NEVER_COMPOST = /(_sapling$|_propagule$|^apple$|^bone_meal$|_log$|_wood$|_planks$|_ore$|^raw_|_ingot$|_(pickaxe|axe|shovel|hoe|sword)$)/

/** Is this item ballast a composter may consume? NEVER_KEEP (worth nothing to the fleet) AND verified compostable. */
export function isCompostJunk (name) {
  return typeof name === 'string' && NEVER_KEEP.has(name) && Object.hasOwn(COMPOST_CHANCE, name) && !NEVER_COMPOST.test(name)
}

/** At most this many items per visit: ~21 leaf_litter fill a composter once, and every insert is a server round trip. */
export const MAX_ITEMS_PER_VISIT = 160
/** Wall clock for the composting loop itself, inside the skill contract and the runner's 180 s watchdog. */
export const VISIT_BUDGET_MS = 45_000

/**
 * compostPlan(items) -> { slots, junk, take: [{ name, count }] }
 *   items  mineflayer Item[] as bot.inventory.items() returns (one entry per occupied slot)
 *   take   what to insert, in order, at most `maxItems` in total. Ordered by RANK, then name.
 * Pure. The trigger is NOT here (compostDue owns it): this only answers "what, and how much".
 */
export function compostPlan (items = [], { maxItems = MAX_ITEMS_PER_VISIT } = {}) {
  const list = (Array.isArray(items) ? items : []).filter(it => it?.name)
  const counts = {}
  for (const it of list) if (isCompostJunk(it.name)) counts[it.name] = (counts[it.name] ?? 0) + (it.count ?? 0)
  const junk = Object.values(counts).reduce((a, b) => a + b, 0)
  let left = Math.max(0, maxItems)
  const take = []
  for (const name of Object.keys(counts).sort((a, b) => RANK(a) - RANK(b) || a.localeCompare(b))) {
    if (left <= 0) break
    const n = Math.min(left, counts[name])
    if (n > 0) { take.push({ name, count: n }); left -= n }
  }
  return { slots: list.length, junk, take }
}

/**
 * Which stack of `name` to put in the hand next: the SMALLEST, so each insert brings a slot nearer to empty.
 * 454 leaf_litter is eight stacks; nibbling a full one frees nothing, finishing the partial one frees a slot.
 */
export function nextStack (items = [], name) {
  return (Array.isArray(items) ? items : []).filter(it => it?.name === name && (it.count ?? 0) > 0)
    .sort((a, b) => (a.count - b.count) || ((b.slot ?? 0) - (a.slot ?? 0)))[0] ?? null
}

/** "At town": horizontally this close to home... */
export const TOWN_RADIUS = 48
/** ...and town storage (a chest/barrel) in sight this close. */
export const STORAGE_NEAR = 16
/** A composter anywhere this close counts as the town's; a builder never places a second one inside it. */
export const COMPOSTER_RADIUS = 48

/**
 * IS A COMPOSTING VISIT DUE? Pure. Only at town, only under slot pressure, only with something to compost.
 * `storageNear` may be a function: it is a world scan, so it is evaluated LAST and only when everything cheap passed.
 */
export function compostDue ({ slots = 0, junk = 0, distHome = Infinity, storageNear = false } = {}) {
  if (!(slots >= TRIGGER_SLOTS)) return false
  if (!(junk > 0)) return false
  if (!(distHome <= TOWN_RADIUS)) return false
  return !!(typeof storageNear === 'function' ? storageNear() : storageNear)
}

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
 * composterBuildPlan(counts, { tableAvailable }) -> null | { carried: true } | { wood, log, logCrafts, slabCrafts, needTable }
 *   counts          name -> count held
 *   tableAvailable  a crafting table is carried or already placed within craft's 32-block search
 * The cheapest single-wood route to one composter from what is HELD -- never a gather. Null when nothing held makes
 * one: that is the refusal, and the remedy it names (3 logs of one wood, 2 with a table at hand) is a gather the model
 * can choose anywhere.
 * Crafts are counted in OPERATIONS, which is what craft()'s `count` means (bot.craft(recipe, count) runs it count times).
 */
export function composterBuildPlan (counts = {}, { tableAvailable = false } = {}) {
  if ((counts.composter ?? 0) > 0) return { carried: true }
  let best = null
  for (const wood of WOODS) {
    const slabs = counts[`${wood}_slab`] ?? 0, planks = counts[`${wood}_planks`] ?? 0, logs = counts[logOf(wood)] ?? 0
    const slabCrafts = Math.ceil(Math.max(0, SLABS_PER_COMPOSTER - slabs) / SLABS_PER_CRAFT)
    const planksNeeded = slabCrafts * PLANKS_PER_SLAB_CRAFT + (tableAvailable ? 0 : PLANKS_PER_TABLE)
    const logCrafts = Math.ceil(Math.max(0, planksNeeded - planks) / PLANKS_PER_LOG)
    if (logCrafts > logs) continue
    const cost = logCrafts * 10 + slabCrafts
    if (!best || cost < best.cost) best = { wood, log: logOf(wood), logCrafts, slabCrafts, needTable: !tableAvailable, cost }
  }
  if (!best) return null
  const { cost, ...plan } = best
  return plan
}

/** Defer to a lower-named bot at town at most this many visits, then build anyway (no starvation). */
export const BUILDER_MAX_DEFERRALS = 3

/**
 * ONE BUILDER PER TOWN, WITHOUT A SERVER. Pure.
 *   myName    this bot
 *   peers     names of OTHER players seen within TOWN_RADIUS of home right now
 *   deferrals how many visits this bot has already deferred
 * The lowest name at town builds. A bot that sees a lower name defers -- but only BUILDER_MAX_DEFERRALS times, so a
 * lower-named bot that never builds (no wood, never full) cannot block the town forever. The authoritative guard is
 * the re-scan for a composter immediately before crafting and again before placing (skills.mjs); this only stops
 * two bots that arrive together from both spending wood.
 */
export function builderDecision ({ myName = '', peers = [], deferrals = 0 } = {}) {
  const lower = (Array.isArray(peers) ? peers : []).filter(n => typeof n === 'string' && n && n !== myName && n < myName).sort()
  if (lower.length && deferrals < BUILDER_MAX_DEFERRALS) return { build: false, defer: true, to: lower[0] }
  return { build: true, defer: false, to: null }
}

// ---- where to put it ------------------------------------------------------------------------------------------

/** A chest lid must still open and its front stay reachable: nothing within this distance of a container. */
export const MIN_CONTAINER_DISTANCE = 3
/** Stay off the home point: every bot's `home` walk ends within 2 blocks of it. */
export const HOME_CLEARANCE = 3
const SITE_REACH = 4
const PLACEABLE_INTO = new Set(['air', 'cave_air', 'short_grass', 'fern', 'dead_bush'])
const LIQUID = /^(water|lava|flowing_water|flowing_lava|bubble_column)$/
const FLOOR_NO = /(^chest$|^trapped_chest$|^barrel$|^composter$|^crafting_table$|furnace$|^smoker$|_leaves$|^dirt_path$|^farmland$|_slab$|_stairs$|_door$|_trapdoor$|^scaffolding$|^ice$)/
export const CONTAINER = /^(chest|trapped_chest|barrel)$/

/**
 * chooseComposterSite({ origin, read, containers, home, occupied }) -> { x, y, z, nearestContainer } | null
 *   origin      the bot's feet cell {x,y,z} (integers)
 *   read        (x,y,z) -> { name, boundingBox } | null   (null = unknown: never chosen)
 *   containers  [{x,y,z}] chests/barrels near the bot
 *   home        {x,z} town centre
 *   occupied    [{x,y,z}] cells an entity stands in
 * Pure. A cell within SITE_REACH of the bot, replaceable, on a solid full floor that is not a container, station,
 * path or slab; >= MIN_CONTAINER_DISTANCE from every container; off the home point; not beside liquid; not a doorway
 * or corridor (solid on both sides along either axis) and not within 2 of a door or gate. Ranked: within 3..6 of
 * storage first (findable from the chests), then nearest the bot, then x/z/y for determinism.
 */
export function chooseComposterSite ({ origin, read, containers = [], home = null, occupied = [] } = {}) {
  if (!origin || typeof read !== 'function') return null
  const solid = b => !!b && b.boundingBox === 'block'
  const occ = new Set((occupied ?? []).map(p => `${p.x},${p.y},${p.z}`))
  const out = []
  for (let dx = -SITE_REACH; dx <= SITE_REACH; dx++) {
    for (let dz = -SITE_REACH; dz <= SITE_REACH; dz++) {
      if (dx === 0 && dz === 0) continue                      // never the bot's own column
      if (Math.hypot(dx, dz) > SITE_REACH) continue
      for (const dy of [0, -1, 1]) {
        const x = origin.x + dx, y = origin.y + dy, z = origin.z + dz
        if (occ.has(`${x},${y},${z}`) || occ.has(`${x},${y - 1},${z}`)) continue
        const cell = read(x, y, z), floor = read(x, y - 1, z)
        if (!cell || !floor || !PLACEABLE_INTO.has(cell.name)) continue
        if (!solid(floor) || FLOOR_NO.test(floor.name ?? '')) continue
        const sides = [read(x + 1, y, z), read(x - 1, y, z), read(x, y, z + 1), read(x, y, z - 1)]
        if (sides.some(b => !b)) continue                      // unknown neighbour: never on a guess
        if (sides.some(b => LIQUID.test(b.name ?? ''))) continue
        if ((solid(sides[0]) && solid(sides[1])) || (solid(sides[2]) && solid(sides[3]))) continue   // corridor / doorway
        let door = false
        for (let ax = -2; ax <= 2 && !door; ax++) {
          for (let az = -2; az <= 2 && !door; az++) {
            for (const ay of [0, 1]) if (/_door$|_gate$/.test(read(x + ax, y + ay, z + az)?.name ?? '')) door = true
          }
        }
        if (door) continue
        if (home && Math.hypot(x - home.x, z - home.z) < HOME_CLEARANCE) continue
        let nearest = Infinity
        for (const c of containers) nearest = Math.min(nearest, Math.hypot(x - c.x, y - c.y, z - c.z))
        if (nearest < MIN_CONTAINER_DISTANCE) continue
        out.push({ x, y, z, nearestContainer: nearest, fromBot: Math.hypot(dx, dy, dz) })
      }
    }
  }
  const band = n => (n <= 6 ? 0 : 1)
  out.sort((a, b) => band(a.nearestContainer) - band(b.nearestContainer) || a.fromBot - b.fromBot || a.x - b.x || a.z - b.z || a.y - b.y)
  const best = out[0]
  return best ? { x: best.x, y: best.y, z: best.z, nearestContainer: best.nearestContainer } : null
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
