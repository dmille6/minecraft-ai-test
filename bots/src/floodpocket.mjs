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
  const blocks = need + 4   // + up to two side fills, one seal, one spare (step 4b, 2026-09-15); was + 2
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

/**
 * Step 4b: the shallow-water side exit. The pillar has the bot standing in the water cell above its own top block,
 * head in air; a jump from water cannot lift the hitbox out of the target cell, but a bot swimming up against a
 * one-block ledge is thrown onto it (prismarine-physics outOfLiquidImpulse). Choose the cardinal side cell N to make
 * that ledge in: `at(x, y, z)` -> block or null.
 *   - headroom: (N, feetY+1) and (N, feetY+2) passable (not solid) and not liquid
 *   - a ledge: (N, feetY) solid already (zero fills), or water/air with a solid block within `maxFill` cells below
 *     (the cells between are air/water-like and are filled bottom-up); nothing lava-like anywhere in that column
 * Returns { n: [dx, dz], fill: [y, ...] (ascending, the last is feetY), seal: [fx, feetY, fz] } or { why }.
 * Prefers the side with the fewest fills; ties in the order east, west, south, north.
 */
export function sideExit (at, fx, fz, feetY, { maxFill = 2 } = {}) {
  const solid = b => !!b && b.boundingBox === 'block'
  const liquid = b => !!b && /water|lava|kelp|seagrass|bubble_column/.test(b.name || '')
  const lavaish = b => !!b && /lava|magma|fire/.test(b.name || '')
  const passable = b => !!b && !solid(b) && !liquid(b)
  const fillable = b => !!b && (b.name === 'air' || b.name === 'cave_air' || /water|kelp|seagrass|bubble_column/.test(b.name || ''))   // replaceable by a placed block; anything else (a torch, a sign, a plant) is not assumed to be
  let best = null; const whys = []
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = fx + dx, nz = fz + dz
    const h1 = at(nx, feetY + 1, nz), h2 = at(nx, feetY + 2, nz)
    if (!passable(h1) || !passable(h2)) { whys.push(`${dx},${dz}: no headroom`); continue }
    const fill = []; let ok = false
    for (let y = feetY; y >= feetY - maxFill; y--) {
      const b = at(nx, y, nz)
      if (b == null || lavaish(b)) { whys.push(`${dx},${dz}: ${b == null ? 'unknown' : b.name} at y=${y}`); break }
      if (solid(b)) { ok = true; break }   // a solid cell at feet level with headroom above is a READY ledge: zero fills (the Delta shaft's top, 2026-09-15)
      if (!fillable(b)) { whys.push(`${dx},${dz}: ${b.name} at y=${y} is not fillable`); break }
      fill.unshift(y)
    }
    if (!ok) { if (fill.length > maxFill) whys.push(`${dx},${dz}: floor deeper than ${maxFill}`); else if (fill.length && !solid(at(nx, feetY - maxFill - 1, nz))) whys.push(`${dx},${dz}: no floor within ${maxFill + 1}`); continue }
    if (!best || fill.length < best.fill.length) best = { n: [dx, dz], fill, seal: [fx, feetY, fz] }
  }
  return best ?? { why: `no side to step out on (${whys.join('; ') || 'no cardinal cell known'})` }
}
