// THE TOWN'S GROUND (townground-2026-10-13.md, sections 2.3-2.4). Pure: no bot, no world reads.
//
// WHY. Measured 10-13 (region files, fresh seed terrain regenerated on Paper 1.21.8 vs the live worlds, 16 towns): within
// 15 blocks of home the bots have removed 9.0 cells per column since each world began -- 3.4x the 35-48 ring -- and 64%
// of the top four layers. The junk well's site rule then fails in 13 of 16 towns, while the same search on the seed's
// untouched terrain finds a site in 16 of 16 (95-340 valid caps on day 0, 0-7 by day 16-24 in the same worlds).
//
// THIS FILE answers one question: is this cell the town's ground? The `_dig_town` instrument (digtown.mjs) records digs
// by this class; the zone (step 3) refuses DISCRETIONARY target digs of it and prices transit through it.
//
// THE BOX: a SQUARE (Chebyshev) of half-width 16 around home -- the well search reaches Chebyshev 14 and its shell 2
// more -- from home.y - 12 up (candidate caps start at home.y - 8, the ring reaches g - 3). Horizontal distance alone is
// not enough: a circle of 16 leaves the corners of the well search's square uncovered (Codex r1 P2).
//
// GROUND is TERRAIN only. Vegetation (logs, leaves, saplings, plants: the planted trees must stay harvestable) and town
// furniture (containers, stations, beds, torches, trapdoors, the composter: they keep their own rules) are never ground.
// stone_bricks IS ground: it is the town platform place-town.py stamps (13x13 at home.y - 2).
// The zone is OFF (every cell 'free') when home is unknown: that FAILS OPEN, on purpose and by name -- the bot behaves
// exactly as before rather than refusing everything.

export const TOWN_GROUND_HALF = 16
export const TOWN_GROUND_DEPTH = 12
/** The instrument also counts digs this far outside the zone, so a change at the edge is visible. */
export const TOWN_MARGIN = 4

export const TERRAIN = /^(stone|cobblestone|mossy_cobblestone|stone_bricks|deepslate|cobbled_deepslate|andesite|diorite|granite|tuff|calcite|dripstone_block|smooth_basalt|sandstone|red_sandstone|dirt|coarse_dirt|rooted_dirt|grass_block|podzol|mycelium|mud|clay|sand|red_sand|gravel|dirt_path|farmland|terracotta|[a-z_]+_terracotta|moss_block)$|_ore$/

/** -> { x, y, z } | null. A home whose coordinates are not all finite is unknown. */
export function homeOf (h) {
  if (!h) return null
  const x = Number(h.x ?? h.homeX), y = Number(h.y ?? h.homeY), z = Number(h.z ?? h.homeZ)
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) ? { x, y, z } : null
}

/** Is the integer cell inside the town box (grown by `margin`)? Pure. */
export function inTownBox (p, home, { margin = 0 } = {}) {
  const h = homeOf(home)
  if (!h || !p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) return false
  const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z)
  const R = TOWN_GROUND_HALF + margin
  return Math.abs(x - Math.floor(h.x)) <= R && Math.abs(z - Math.floor(h.z)) <= R && y >= Math.floor(h.y) - TOWN_GROUND_DEPTH - margin
}

export const isTerrain = name => typeof name === 'string' && TERRAIN.test(name)

/** 'ground' | 'free'. Pure. */
export function townDigClass (p, blockName, home) {
  return inTownBox(p, home) && isTerrain(blockName) ? 'ground' : 'free'
}

/**
 * THE TOWN'S HOME: config's home ONLY when HOME_X, HOME_Y and HOME_Z were set in the environment (every fleet env file
 * sets them; config.mjs defaults a missing one to 0/70/0, which is not a town). Unset -> null -> every cell is 'free'.
 */
export function configuredHome (world, env = process.env) {
  if (env.HOME_X == null || env.HOME_Y == null || env.HOME_Z == null || env.HOME_X === '' || env.HOME_Y === '' || env.HOME_Z === '') return null
  return homeOf({ x: world?.homeX, y: world?.homeY, z: world?.homeZ })
}
