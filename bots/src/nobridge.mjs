// NOBRIDGE-01: NO PATH SCAFFOLD OVER WATER ON A WALK (LIVE 10-27 showcase: 52 dirt blocks laid at y=62 across open water in the
// lake). The walk keeps allow1by1towers and the extended scaffold list (index.mjs extendScaffolding) for PILLARING; those same
// two settings let mineflayer-pathfinder 2.4.5 BRIDGE: getMoveForward places the cell under the next step when it is not
// physical and the step is not liquid (movements.js 361-388: it prices that placement as exclusionPlace(blockC), the STEP's
// cell, one above the block it places), and getMoveJumpUp places C and D under a jump (exclusionPlace(blockD), (blockC)).
// getMoveUp, the 1x1 tower, places into the bot's own cell and already refuses it in liquid. So the narrowest override is an
// exclusionAreasPlace entry: 100 (the move is dropped) when the priced cell, or the open column under it, meets water before a
// solid block. The bot swims instead (water is terrain, priced in index.mjs). Real bridges are a separate, designed feature.
// Walking profiles only: the ascend / descend / water escapes keep every placement they had.

export const NOBRIDGE_PROFILES = Object.freeze(new Set(['walk', 'gather', 'composter_walk', 'town_deposit_walk']))
export const NOBRIDGE_COST = 100
/** How far below the priced cell water still counts as "under" a placement: the step cell, the placed cell, two more. */
export const NOBRIDGE_DEPTH = 4
const WATERY = /^(water|bubble_column|kelp|kelp_plant|seagrass|tall_seagrass)$/
const OPEN = /^(air|cave_air|void_air)$/

/**
 * Does a placement priced at the top of this column go over or into water? `names` is the priced cell and the cells under it,
 * top first. Water (or a water-only plant) before the first block that is neither air nor water -> true. A solid (or any other)
 * block first, or a column that runs out unread -> false. Pure.
 */
export function overWater (names) {
  for (const n of (names ?? []).slice(0, NOBRIDGE_DEPTH)) {
    if (n == null) return false
    const s = String(n)
    if (WATERY.test(s)) return true
    if (!OPEN.test(s)) return false
  }
  return false
}

/** The exclusionAreasPlace entry -> (block) => 0 | NOBRIDGE_COST. `read(x, y, z)` -> a block name | null; `profile()` the walk's. */
export function noBridgeCost (read, profile) {
  return block => {
    const p = block?.position
    if (!p || !NOBRIDGE_PROFILES.has(profile?.())) return 0
    const names = [block.name]
    for (let i = 1; i < NOBRIDGE_DEPTH; i++) names.push(read(p.x, p.y - i, p.z))
    return overWater(names) ? NOBRIDGE_COST : 0
  }
}
