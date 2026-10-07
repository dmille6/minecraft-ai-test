// THE PEACEFUL KIT: in a peaceful world swords are never made, chased or banked (wooden ones feed a furnace that is
// already burning), and the plants nobody can use there are composted. The SAME switch as the peaceful food policy (foodskip.mjs: FOOD_SKIP = auto | on | off, default auto =
// active only while the server's own `difficulty` packet says peaceful). One switch: turning the world to easy, normal
// or hard -- or FOOD_SKIP=off -- turns ALL of it off, and every function below then returns exactly the old answer.
//
// OWNER, 2026-10-07 (approved): "(3) SWORDS ... never craft a sword; the pickup sweep does not walk to a sword drop; swords
// the bot carries are BANKED into a town chest at the next town deposit or bank visit. They are not junk; they are
// useful in non-peaceful worlds, so banking is allowed. Never toss or drop. (4) COMPOST MORE ... the plant items that are
// useless in a peaceful world".
// OWNER, 2026-10-07 ~19:50Z (revision): "no reason to store swords at all, this is a peaceful world" -- banking REMOVED;
// no-craft and no-chase kept; when the bot is ALREADY smelting (never a smelt started for this) carried wooden swords are
// preferred over ordinary fuel; stone swords stay in the bag (junkwell-02 disposes of them under this switch, importing
// unwantedSword below). Saplings: oak and birch keep 16, every other species none. Compost also dried_kelp,
// glow_berries, moss_carpet, firefly_bush, bush and bread. The full-bag guard counts the real surplus after reserves.
//
// MEASURED (fleet c6e91a8, 12 h to 10-07 17:30Z, 80 bots, last snapshot per bot): 68 stone + 55 wooden swords in 73 of
// 80 bags (123 slots, ~4.9% of 2,494 used); ONE sword crafted in those 12 h (and 3 sword craft proposals in 70,115
// decisions over 24 h) -- the swords are stock, not inflow, so the bank is what moves them. Sword-holding bots made 76
// successful unnamed deposits in 441 bot-h (0.17 / bot-h): that is the trip the swords ride on. No new trip.
// Plant stock in the same bags (slots): wildflowers 34, melon_slice 27, brown_mushroom 26, kelp 19, red_mushroom 12,
// rose_bush 9, cocoa_beans 9, peony 8, other flowers ~20 -- ~165 slots the composter refuses today.
//
// WHY THESE ITEMS AND THESE CHANCES. Every name below was put through a real Paper 1.21.8-60 composter on the sandbox
// (RCON only: a hopper of 64 above a composter above a hopper; docs/reports/peacefulkit-design-2026-10-07.md has the
// table): every one was CONSUMED 64/64, and the negative controls (stone_sword, wooden_sword, egg, flint, bamboo,
// dead_bush, ink_sac) 0/N. The chances are vanilla's ComposterBlock.bootStrap (NeoForge's generated 1.21.8
// compostables.json and the decompiled source agree; the sandbox's bone-meal counts are consistent with them). A
// composter consumes whatever it accepts at levels 0-6 -- the chance only decides whether the level rises -- so the
// allowlist IS the safety: nothing outside it is ever offered.
//
// NOT IN THIS LIST, ON PURPOSE (compostable on Paper, not approved): short/tall_dry_grass and the other foods (carrot,
// potato, cookie ...). dried_kelp, glow_berries, moss_carpet, firefly_bush, bush and bread were ADDED by the owner on
// 10-07 ~19:50Z (bread too: only while the switch is on, so a world with hunger keeps its bread). Already composted without
// the switch (composter.mjs COMPOST_CHANCE: leaf_litter, wheat/beetroot/melon/pumpkin seeds, poppy, dandelion, grass,
// fern, vine, seagrass; saplings above SAPLING_RESERVE) and apples above APPLE_RESERVE (the food policy): unchanged.

/** Vanilla chances (Java 1.21.8) for the plants the switch adds. Each one verified compostable on the real Paper server. */
export const PEACEFUL_COMPOST = Object.freeze({
  // the owner's named plants
  melon_slice: 0.5, kelp: 0.3, brown_mushroom: 0.65, red_mushroom: 0.65, cocoa_beans: 0.65, sweet_berries: 0.3,
  // the other seeds (wheat/beetroot/melon/pumpkin seeds are already composted without the switch)
  torchflower_seeds: 0.3, pitcher_pod: 0.3,
  // flowers: small, tall, and the 1.21.5 ones (poppy and dandelion are already composted without the switch)
  blue_orchid: 0.65, allium: 0.65, azure_bluet: 0.65, red_tulip: 0.65, orange_tulip: 0.65, white_tulip: 0.65,
  pink_tulip: 0.65, oxeye_daisy: 0.65, cornflower: 0.65, lily_of_the_valley: 0.65, wither_rose: 0.65,
  closed_eyeblossom: 0.65, open_eyeblossom: 0.65, torchflower: 0.85,
  sunflower: 0.65, lilac: 0.65, rose_bush: 0.65, peony: 0.65, pitcher_plant: 0.85,
  wildflowers: 0.3, pink_petals: 0.3, cactus_flower: 0.3,
  // OWNER 10-07 ~19:50Z, added: each consumed 64/64 by the Paper composter in the same hopper test.
  dried_kelp: 0.3, glow_berries: 0.3, moss_carpet: 0.3, firefly_bush: 0.3, bush: 0.3, bread: 0.85,
})

/** One of the plants the switch adds to the composter? Pure. (Not the ones it already took.) */
export const isPeacefulCompost = name => typeof name === 'string' && Object.hasOwn(PEACEFUL_COMPOST, name)

/** Seeds-like plants go in with the seeds, flowers with the flowers, the rest last (composter.mjs RANK). */
export function peacefulRank (name) {
  if (!isPeacefulCompost(name)) return null
  if (/_seeds$|^pitcher_pod$|^cocoa_beans$/.test(name)) return 2
  if (/^(melon_slice|kelp|dried_kelp|brown_mushroom|red_mushroom|sweet_berries|glow_berries|bread)$/.test(name)) return 5
  if (/^(moss_carpet|bush|firefly_bush)$/.test(name)) return 4
  return 3
}

/** Every sword: wooden, stone, iron, golden, diamond, netherite. */
export const isSword = name => typeof name === 'string' && /_sword$/.test(name)

/**
 * NEVER CRAFT A SWORD WHILE ACTIVE -> the refusal's detail, or null. Pure. The remedy is one the bot can perform from
 * wherever it is (CLAUDE.md: a refusal names an executable remedy): another verb, never a precondition it cannot meet.
 */
export function swordCraftRefusal (item, active) {
  if (!active || !isSword(item)) return null
  return `${item} is not crafted in a peaceful world (no hostile mob spawns here, so a sword has no job; the swords you carry ` +
         'are banked at the next deposit) -- craft a pickaxe, axe or shovel, or gather instead'
}

/**
 * Should pickupNearbyItems leave this item entity on the floor because it is a sword and the switch is active? Pure over
 * the entity (prismarine-entity getDroppedItem). An unreadable entity is chased as before. This governs the WALK only:
 * the server still hands over a sword that lands within ~1 block of the bot (owner: that is fine).
 */
export function skipSwordDrop (entity, active) {
  if (!active) return false
  try { return isSword(entity?.getDroppedItem?.()?.name) } catch { return false }
}

/**
 * IS THIS AN UNWANTED SWORD? -> true | false. Pure. THE peaceful-only classification (OWNER 10-07 ~19:50Z: "no reason to
 * store swords at all, this is a peaceful world"): any sword, any tier, any durability -- but ONLY while the peaceful
 * switch is active; otherwise a sword is a tool like any other. `item` is an Item or { name }. Exported for the junk well
 * (junkwell-02 disposes of unwanted swords under the same switch), the bank (never banks one) and the furnace (burns the
 * wooden ones). Callers pass the switch's reading AT THE MOMENT they act.
 */
export const unwantedSword = (item, peacefulActive) => !!peacefulActive && isSword(item?.name)

/** A sword the furnace may burn: an unwanted WOODEN sword (vanilla fuel, 200 ticks = one smelted item). Stone swords
 *  do not burn; they stay in the bag for the well. */
export const burnableSword = (item, peacefulActive) => unwantedSword(item, peacefulActive) && item?.name === 'wooden_sword'

/** Burn time of one wooden sword in ticks (vanilla AbstractFurnaceBlockEntity: wooden tools 200), exactly one item. */
export const SWORD_FUEL_TICKS = 200

/** How many carried copies the furnace may burn now -> a count. Pure over the bag's Items and the switch's reading. */
export function swordFuelCount (items = [], peacefulActive = false) {
  return (Array.isArray(items) ? items : []).filter(it => burnableSword(it, peacefulActive)).reduce((n, it) => n + (it.count ?? 1), 0)
}

/**
 * SAPLINGS KEPT PER SPECIES WHILE THE SWITCH IS ON (OWNER 10-07 ~19:50Z): oak and birch keep 16 per bot -- bots replant
 * where they chop, and the tree farm plants birch then oak -- and every other species keeps NONE (its slot is freed; leaf
 * drops bring saplings back constantly). -> the reserve, or null when the species is not a sapling.
 */
export const KEPT_SAPLINGS = Object.freeze(['oak_sapling', 'birch_sapling'])
export function peacefulSaplingReserve (name, base = 16) {
  if (typeof name !== 'string' || !/_sapling$/.test(name)) return null
  return KEPT_SAPLINGS.includes(name) ? base : 0
}

/** The `_peaceful_kit` row: one per process per change of (decision, difficulty), beside foodskip's `_food_skip` row. */
export function peacefulKitDetail ({ mode = 'auto', difficulty = null, active = false } = {}) {
  return `peaceful kit ${active ? 'ON' : 'off'}: swords=${active ? 'no_bank,no_craft,no_chase,burn_wooden' : 'as_before'} ` +
         `compost=${active ? 'plants' : 'as_before'} mode=${mode} difficulty=${difficulty ?? 'unknown'} active=${active ? 1 : 0}`
}
