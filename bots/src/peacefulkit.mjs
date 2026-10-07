// THE PEACEFUL KIT: in a peaceful world, swords are banked and never made, and the plants nobody can use there are
// composted. The SAME switch as the peaceful food policy (foodskip.mjs: FOOD_SKIP = auto | on | off, default auto =
// active only while the server's own `difficulty` packet says peaceful). One switch: turning the world to easy, normal
// or hard -- or FOOD_SKIP=off -- turns ALL of it off, and every function below then returns exactly the old answer.
//
// OWNER, 2026-10-07 (approved): "(3) SWORDS ... never craft a sword; the pickup sweep does not walk to a sword drop; swords
// the bot carries are BANKED into a town chest at the next town deposit or bank visit. They are not junk; they are
// useful in non-peaceful worlds, so banking is allowed. Never toss or drop. (4) COMPOST MORE ... the plant items that are
// useless in a peaceful world".
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
// NOT IN THIS LIST, ON PURPOSE (all compostable on Paper, none approved): dried_kelp and glow_berries (food the owner did
// not name), bush, firefly_bush, moss_carpet, short/tall_dry_grass, bread and the other foods. Already composted without
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
})

/** One of the plants the switch adds to the composter? Pure. (Not the ones it already took.) */
export const isPeacefulCompost = name => typeof name === 'string' && Object.hasOwn(PEACEFUL_COMPOST, name)

/** Seeds-like plants go in with the seeds, flowers with the flowers, the rest last (composter.mjs RANK). */
export function peacefulRank (name) {
  if (!isPeacefulCompost(name)) return null
  if (/_seeds$|^pitcher_pod$|^cocoa_beans$/.test(name)) return 2
  if (/^(melon_slice|kelp|brown_mushroom|red_mushroom|sweet_berries)$/.test(name)) return 5
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
 * MAY A DEPOSIT BANK EVERY USABLE COPY OF THIS TOOL (none kept)? Pure. Only a sword, only while active. Otherwise the
 * fleet's tool rule stands: the best usable copy of each name stays in the bag. A spent copy (toolfor FLOOR) never moves
 * either way -- the bank is not a bin.
 */
export const bankEveryCopy = (name, active) => !!active && isSword(name)

/** The `_peaceful_kit` row: one per process per change of (decision, difficulty), beside foodskip's `_food_skip` row. */
export function peacefulKitDetail ({ mode = 'auto', difficulty = null, active = false } = {}) {
  return `peaceful kit ${active ? 'ON' : 'off'}: swords=${active ? 'bank,no_craft,no_chase' : 'as_before'} ` +
         `compost=${active ? 'plants' : 'as_before'} mode=${mode} difficulty=${difficulty ?? 'unknown'} active=${active ? 1 : 0}`
}
