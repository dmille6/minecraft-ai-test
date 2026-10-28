// NOBRIDGE-01: NO PATH SCAFFOLD OVER WATER ON A WALK (LIVE 10-27 showcase: 52 dirt blocks laid at y=62 across open water in the
// lake). The walk keeps allow1by1towers and the extended scaffold list (index.mjs extendScaffolding) for PILLARING; those same
// two settings let mineflayer-pathfinder 2.4.5 BRIDGE: getMoveForward places the cell under the next step when it is not
// physical and the step is not liquid (movements.js 361-388: it prices that placement as exclusionPlace(blockC), the STEP's
// cell, one above the block it places), and getMoveJumpUp places C and D under a jump (exclusionPlace(blockD), (blockC)).
// getMoveUp, the 1x1 tower, places into the bot's own cell and already refuses it in liquid. So the narrowest override is an
// exclusionPlace override: 100 (the move is dropped) when the priced cell is water, or the open column under it meets water
// before a solid block. The bot swims instead (water is terrain, priced in index.mjs). Real bridges are a separate, designed
// feature. Bound to the SEARCHED Movements object (`this.noBridge`, r2 Codex P2: a shared callback reading bot.movementProfile
// vetoed the ascent probes skills.mjs runs while the active profile is still `walk`): the walk and its walking clones carry it;
// ascend, descend, water and tunnel clear it and keep every placement they had.

export const NOBRIDGE_COST = 100
/** How far below the priced cell water still counts as "under" a placement (r2 Codex P2: 4 let a bot bridge from a high bank). */
export const NOBRIDGE_DEPTH = 24
const WATERY = /^(water|bubble_column|kelp|kelp_plant|seagrass|tall_seagrass)$/
// what a scaffold may be placed into and a bot walk through: the column goes on through these
const OPEN = /^(air|cave_air|void_air|short_grass|tall_grass|fern|large_fern|dead_bush|vine|glow_lichen|snow)$/

/**
 * Does a placement priced at the top of this column go over or into water? `name(i)` -> the block name i cells below the
 * priced cell (0 = the priced cell), read lazily, a WATERLOGGED block reported as 'water'. The priced cell itself counts only
 * when it is water (r2 Codex P2: it is the STEP cell, one above the placed block, and a lily pad there hid the lake); below it
 * water before the first block the column cannot pass -> true; that block, or an unread cell, first -> false. Pure.
 */
export function overWater (name, depth = NOBRIDGE_DEPTH) {
  const at = typeof name === 'function' ? name : i => name?.[i]
  const top = at(0)
  if (top != null && WATERY.test(String(top))) return true
  for (let i = 1; i < depth; i++) {
    const n = at(i)
    if (n == null) return false
    const s = String(n)
    if (WATERY.test(s)) return true
    if (!OPEN.test(s)) return false
  }
  return false
}

/** A block's name for this rule: 'water' when it is waterlogged. */
export const wetName = b => (b == null ? null : (b.getProperties?.().waterlogged === true || b.getProperties?.().waterlogged === 'true') ? 'water' : b.name)

/**
 * INSTALL on a Movements object -> it. `read(x, y, z)` -> a block | null. exclusionPlace becomes the library's own sum plus
 * NOBRIDGE_COST over water while `this.noBridge` is true (a plain function, never bound: the Object.assign clones in index.mjs
 * carry it with `this` the clone being searched).
 */
export function installNoBridge (movements, read) {
  if (!movements || movements.__noBridge) return movements
  const base = Object.getPrototypeOf(movements).exclusionPlace
  movements.exclusionPlace = function (block) {
    const w = base.call(this, block)
    const p = block?.position
    if (!this.noBridge || !p) return w
    return w + (overWater(i => (i === 0 ? wetName(block) : wetName(read(p.x, p.y - i, p.z)))) ? NOBRIDGE_COST : 0)
  }
  movements.noBridge = true
  movements.__noBridge = true
  return movements
}
