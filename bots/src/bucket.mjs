// A BUCKET REMOVES ONE BLOCK OF WATER. THE QUESTION IS WHETHER IT STAYS REMOVED.
//
// Minecraft's fluid rules decide this, and they are unforgiving (minecraft.wiki
// /Water, Java 1.21):
//
//   - "A water source block is created from a flowing block that is
//     horizontally adjacent to two or more other source blocks" -- so scooping
//     a cell with >= 2 source neighbours reforms it.
//   - Water spreads 1 block per 5 game ticks, i.e. a refill lands in ~0.25s.
//   - "Water can spread downward infinitely" -- water directly above refills
//     the hole regardless of what is beside it.
//   - Oceans, lakes and rivers "are generated as stationary", i.e. source
//     blocks throughout.
//
// So the capability has a population only where a bot is in a SEALED POCKET:
// at most one horizontal source neighbour and nothing wet overhead. In an
// ocean, a lake, or the interior of a flooded cave, a bucket buys 5 ticks.
//
// This module is deliberately measurement-first. `scoopLeavesAir` is a pure
// function of blocks the reflex already reads, and it can be logged as an
// observation for a full walk BEFORE any bucket exists on the fleet -- which
// settles whether the population is real for the cost of one function, with a
// denominator rather than a hunch. That matters here: no bot can currently
// obtain a bucket at all (3 iron ingots; the whole fleet holds 15), and
// FILLING a bucket is unvalidated across the entire mineflayer ecosystem --
// every test that exists anywhere, including the maintainer's own, covers
// EMPTYING one.

/** Vanilla water reforms in a cell touching this many horizontal sources. */
export const REFORM_SOURCES = 2

/** 1.21.8 `blockInteractionRange`. The server rejects a use beyond it. */
export const REACH = 4.5

/**
 * A water SOURCE, not flowing water. `metadata === 0` is the source level.
 *
 * Flowing water cannot fill a bucket at all, and `findBlock` matching 'water'
 * returns both kinds indiscriminately -- the single most common bug in every
 * published implementation of this (Voyager and Odyssey both omit the check).
 *
 * Note the trap next door: on a WATERLOGGED block `metadata` means something
 * else entirely, so this must only ever be asked of a block whose name is
 * actually water.
 */
export function isWaterSource (b) {
  return !!b && b.name === 'water' && b.metadata === 0
}

/**
 * Would scooping this cell leave air, or would it refill within 5 ticks?
 *
 * `cardinals` are the four horizontal neighbours of the target. `above` is the
 * cell directly over it. Returns false whenever it cannot tell -- a wrong
 * "yes" here spends the only bucket the bot will ever have.
 */
export function scoopLeavesAir ({ target = null, above = null, cardinals = [] } = {}) {
  if (!isWaterSource(target)) return false
  // Downward flow is unlimited, so anything wet overhead refills the hole
  // whatever the sides say.
  if (above && (above.name === 'water' || above.name === 'lava')) return false
  const sources = (cardinals ?? []).filter(isWaterSource).length
  return sources < REFORM_SOURCES
}

/**
 * Why this scoop cannot be attempted, or null when it can.
 *
 * Ordered by how cheap the answer is, so the common refusals cost nothing.
 */
export function scoopRefusal ({ hasEmptyBucket = false, target = null, above = null,
                                cardinals = [], distance = Infinity } = {}) {
  if (!hasEmptyBucket) return 'no empty bucket'
  if (!target) return 'nothing to scoop'
  if (target.name === 'lava') return 'refusing to scoop lava'
  if (!isWaterSource(target)) {
    return target.name === 'water' ? 'flowing water cannot fill a bucket'
                                   : `not water (${target.name})`
  }
  if (!(distance <= REACH)) return `out of reach (${Number(distance).toFixed(1)} > ${REACH})`
  if (!scoopLeavesAir({ target, above, cardinals })) return 'it would refill within 5 ticks'
  return null
}

/**
 * Where to aim. The server ray-traces the use from the player's look vector,
 * so this is the whole game.
 *
 * Centre of the source block first, then slightly high and slightly low --
 * the multi-aim retry from the only end-to-end implementation that verifies
 * itself against real world state (medievalrp-net/Spyglass). A single aim
 * fails often enough that every working implementation retries.
 *
 * `bot.blockAtCursor()` CANNOT be used to check this: water has an empty
 * boundingBox and no shapes, so mineflayer's client-side raycast passes
 * straight through fluids and returns the solid behind. The server's raycast
 * for an empty bucket is fluid-aware and ours is not, so the aim cannot be
 * predicted or confirmed -- only fired and then verified from the world.
 */
export function scoopAims (pos) {
  return [
    { x: pos.x + 0.5, y: pos.y + 0.5, z: pos.z + 0.5 },
    { x: pos.x + 0.5, y: pos.y + 0.8, z: pos.z + 0.5 },
    { x: pos.x + 0.5, y: pos.y + 0.2, z: pos.z + 0.5 },
  ]
}

/**
 * Did the scoop actually happen?
 *
 * BOTH conditions, and the item id specifically. Verifying by a `blockUpdate`
 * at the target is a lie-generator: flowing water arriving in the hole fires
 * the same event and fabricates a success. And asserting merely "a bucket" lets
 * a lava scoop or a fish scoop read as a water scoop, which is how a bot ends
 * up holding a lava_bucket it will later try to empty.
 */
export function scoopSucceeded ({ blockNow = null, gainedItem = null } = {}) {
  const emptied = !!blockNow && (blockNow.name === 'air' || blockNow.name === 'cave_air')
  return emptied && gainedItem === 'water_bucket'
}

/** Settle time between aiming and using. Two independent sources require it. */
export const AIM_SETTLE_MS = 250
/** Inventory and world sync lag behind the use packet by a few ticks. */
export const CONFIRM_MS = 300

/**
 * Scoop one water source into an empty bucket. FILL ONLY -- there is
 * deliberately no counterpart that empties one.
 *
 * Emptying is the single most destructive thing a bucket can do here: water
 * spreads seven blocks horizontally and falls without limit, so one misplaced
 * pour floods a shaft, drowns the bot, and drowns every bot that walks into it
 * afterwards. It is a permanent world change that cannot be undone, and it is
 * exactly what `dontCreateFlow` exists to prevent. A full bucket that cannot be
 * emptied is a dead item; a bucket that can be emptied is a flood generator. So
 * this module offers no way to pour.
 *
 * The call sequence is `equip -> lookAt -> activateItem`, and the last part is
 * not negotiable: `activateBlock` and `placeBlock` do not work with buckets and
 * have not since at least 2020 (mineflayer PR #3740 carries the comment
 * "dont use activateBlock"; #3731 is still open). MineLand's low-level action
 * routes buckets to `activateBlock` and therefore cannot use them at all.
 *
 * VERSION GATE: before mineflayer 4.37.1, `activateItem` hardcoded
 * `rotation: {x:0, y:0}` in the `use_item` packet, and the server ray-traces
 * from that rotation -- so the bot aimed south-and-level no matter where it
 * looked and buckets silently did nothing on any MC >= 1.21. Fixed by PR #3840,
 * merged 2026-04-02, first released in 4.37.1. This fleet runs 4.37.1 exactly.
 * On anything older this function cannot work, which would present as a
 * confident zero.
 */
export async function scoopLiquid (bot, pos, { sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  const empty = bot.inventory?.items?.().find(i => i.name === 'bucket')
  const target = bot.blockAt?.(pos)
  const at = (dx, dy, dz) => bot.blockAt?.(pos.offset(dx, dy, dz))
  const refusal = scoopRefusal({
    hasEmptyBucket: !!empty,
    target,
    above: at(0, 1, 0),
    cardinals: [at(1, 0, 0), at(-1, 0, 0), at(0, 0, 1), at(0, 0, -1)],
    distance: bot.entity?.position?.distanceTo?.(pos) ?? Infinity,
  })
  if (refusal) return { ok: false, reason: refusal }

  // THE PATHFINDER RE-AIMS EVERY TICK while a path is executing, which stamps
  // the pitch back to level before the use packet goes out. The aim and the use
  // must happen with no active goal.
  try { bot.pathfinder?.setGoal?.(null) } catch { /* no pathfinder is fine */ }

  try { await bot.equip(empty, 'hand') } catch (e) { return { ok: false, reason: `equip failed: ${e.message}` } }

  for (const aim of scoopAims(pos)) {
    try {
      await bot.lookAt(aim, true)
      await sleep(AIM_SETTLE_MS)
      bot.activateItem()
      await sleep(CONFIRM_MS)
    } catch (e) {
      return { ok: false, reason: `use failed: ${e.message}` }
    }
    // Verify from the WORLD and the INVENTORY, never from a blockUpdate event:
    // flowing water arriving in the hole fires the same event a success does.
    const gained = bot.inventory?.items?.().find(i => i.name === 'water_bucket')
    if (scoopSucceeded({ blockNow: bot.blockAt?.(pos), gainedItem: gained?.name ?? null })) {
      return { ok: true, reason: null }
    }
  }
  return { ok: false, reason: 'all aims fired and the water is still there' }
}
