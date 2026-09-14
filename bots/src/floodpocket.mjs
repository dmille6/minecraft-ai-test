// THE FLOODED-POCKET RUNG, pure parts (docs/flooded-pocket-rung-design.md v3, two Codex passes).
//
// A bot floating in a sealed water pocket cannot be surfaced by the air reflex (no breathable route) and cannot
// climb by the ladder (which needs dry). With a pickaxe in hand it can: sink to the floor, pillar up on its own
// blocks, and dig the ceiling cells one at a time between breaths. Bare-handed it cannot (a submerged stone dig is
// 37.5 s against one 15-s breath), and this module says so before anything moves.
//
// Everything here is decided from numbers the caller measures; nothing touches the bot.

export const BREATH_MS = 15_000            // 20 bubbles = 15 s of air
export const PLACE_MS = 800                // one jump-and-place step, measured on the ladder
export const POCKET_WALL_CLOCK_MS = 240_000
export const POCKET_MAX_FLOOR_BELOW = 6
export const POCKET_OXYGEN_FRACTION = 0.75 // an operation may use three quarters of the air the bot has

/** May one uninterrupted submerged operation run on this much air? (Codex v3: per operation, plus the swim back.) */
export function oxygenFitsOperation ({ oxygenLevel, opMs, swimBackMs = 0, breathMs = BREATH_MS, fraction = POCKET_OXYGEN_FRACTION } = {}) {
  if (!(oxygenLevel > 0) || !(opMs >= 0)) return false
  const available = (oxygenLevel / 20) * breathMs * fraction
  return opMs + swimBackMs <= available
}

/**
 * The plan, from the floor: how many blocks, how much time, and every reason not to.
 *   floorY        the solid floor's y (the cell the pillar starts on), or null when none within reach
 *   feetY         where the feet are now
 *   firstDryY     the first breathable cell's y above the column (climbNeedAbove from the floor), or null
 *   columnCells   [{ y, solid, digMs, inflowRisk }] for every cell from floorY+1 up to firstDryY: solid cells are dug
 *                 (digMs priced for the real state: submerged until the surface, a tool in hand), inflowRisk when a
 *                 neighbour other than the pocket's own water below would let liquid in
 *   blocksHeld    placeable blocks in the inventory
 *   toolInHand    whether a pickaxe is held (the caller equips first)
 *   oxygenLevel   bubbles now
 */
export function pocketPlan ({ floorY = null, feetY, firstDryY = null, columnCells = [], blocksHeld = 0, toolInHand = false, oxygenLevel = 0,
                              wallClockMs = POCKET_WALL_CLOCK_MS, maxFloorBelow = POCKET_MAX_FLOOR_BELOW } = {}) {
  const refuse = (why, extra = {}) => ({ ok: false, why, need: null, blocks: null, timeMs: null, ...extra })
  if (floorY == null || !(feetY - floorY <= maxFloorBelow)) return refuse('no floor within reach below')
  if (firstDryY == null) return refuse('no dry opening above the column')
  if (!toolInHand) return refuse('no pickaxe in hand: a submerged bare-hand dig exceeds one breath')
  const need = firstDryY - floorY - 1                      // pillar blocks to stand level with the opening's floor
  if (!(need >= 1)) return refuse('nothing to climb')
  const blocks = need + 2
  if (blocksHeld < blocks) return refuse(`need ${blocks} placeable block(s), have ${blocksHeld}`, { need, blocks })
  const digs = columnCells.filter(c => c.solid)
  const inflow = digs.find(c => c.inflowRisk)
  if (inflow) return refuse(`cell y=${inflow.y} would let liquid in`, { need, blocks })
  const badDig = digs.find(c => !(c.digMs > 0) || !oxygenFitsOperation({ oxygenLevel: 20, opMs: c.digMs, swimBackMs: 0 }))
  if (badDig) return refuse(`submerged dig at y=${badDig.y} exceeds one breath (${Math.round(badDig.digMs ?? 0)} ms)`, { need, blocks })
  const timeMs = digs.reduce((s, c) => s + c.digMs, 0) + need * PLACE_MS
  if (timeMs > wallClockMs) return refuse(`estimated ${Math.round(timeMs / 1000)} s exceeds the ${wallClockMs / 1000}-s budget`, { need, blocks, timeMs })
  if (!oxygenFitsOperation({ oxygenLevel, opMs: 0 })) return refuse('no air to start with', { need, blocks, timeMs })
  return { ok: true, why: null, need, blocks, timeMs, digs: digs.length }
}

/** The rung is done only when the bot is somewhere else, up and dry, breathing, and standing (v3 rule 6). */
export function pocketDone ({ before, after, headBreathable = false, feetSupported = false, minRise = 4 } = {}) {
  if (!before || !after) return false
  const rose = (after.y - before.y) >= minRise
  return rose && !after.wet && !!headBreathable && !!feetSupported
}
