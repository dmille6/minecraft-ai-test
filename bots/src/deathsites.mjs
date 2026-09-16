// DEATH SITES, pure parts (docs/reports/deaths-review-2026-09-16.md, candidate B; two-engine review 16 Sep).
//
// 96 h to 16 Sep: 101 of 198 lava deaths were a second death of the same class within 8 blocks of an earlier one in
// the SAME pool (164 of 198 fleet-wide: every world has the same seed). The fleet already records hazards in the
// pool's world facts and reads them back ONLY as prompt lines -- advice, which the working rules say is not a
// remedy. This module turns a recorded death into a cost the pathfinder pays, and nothing here touches the bot.
//
// THE COST IS 16 AND THAT IS ARITHMETIC, NOT TASTE. mineflayer-pathfinder charges `exclusionStep` three times per
// forward move (the destination cell once directly and again inside safeOrBreak for the head and feet cells) and up
// to six times per DIAGONAL move, and every one of its fifteen `cost > 100` guards deletes the neighbour outright.
// 1.4 + 6 x 16 = 97.4 keeps every move inside the disc legal -- a bot that respawns in one or is walked into one can
// still walk out in any direction -- while a 12-cell crossing costs ~600 against a 1-per-step walk round. 25 already
// deletes the diagonals inside the disc; 60 deletes the forward moves too (1 + 60 + 60), and a wall is a bot that
// cannot leave the disc (both reviews, 16 Sep). The drop-down and step-down moves never price their landing cell
// (movements.js getMoveDropDown/getMoveDown), so a drop INTO a disc from a ledge is not priced: accepted and read on
// the canary, not hidden.
export const DEATH_SITE_RADIUS = 6        // horizontal blocks around the recorded death position
export const DEATH_SITE_DY = 6            // vertical band: a cave under the pool is not the pool
export const DEATH_SITE_STEP_COST = 16    // per priced cell; see above
export const DEATH_SITE_TARGET_RADIUS = 12 // explore does not steer at a sighting this close to a death
export const DEATH_KIND_PREFIX = 'death:'

export const isDeathSite = s => typeof s?.kind === 'string' && s.kind.startsWith(DEATH_KIND_PREFIX)

/** The nearest death site covering (x, y, z), or null. Horizontal distance and a vertical band, like every other site test here. */
export function nearDeathSite (sites, x, y, z, { radius = DEATH_SITE_RADIUS, dy = DEATH_SITE_DY } = {}) {
  if (!Array.isArray(sites) || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null
  let best = null, bestD = Infinity
  for (const s of sites) {
    if (!isDeathSite(s) || !Number.isFinite(s.x) || !Number.isFinite(s.y) || !Number.isFinite(s.z)) continue
    if (Math.abs(s.y - y) > dy) continue
    const d = Math.hypot(s.x - x, s.z - z)
    if (d <= radius && d < bestD) { best = s; bestD = d }
  }
  return best
}

/** exclusionAreasStep entry: the pathfinder hands a prismarine block; the price is on its position. */
export function deathSiteStepCost (sites, block, opts = {}) {
  const p = block?.position
  if (!p || !sites?.length) return 0
  return nearDeathSite(sites, p.x, p.y, p.z, opts) ? (opts.cost ?? DEATH_SITE_STEP_COST) : 0
}

/** Does a planned path (an array of {x, y, z} nodes) pass through a disc? The positive control that the price is live. */
export function pathCrossesDeathSite (sites, nodes, opts = {}) {
  if (!Array.isArray(nodes)) return null
  for (const n of nodes) { const s = nearDeathSite(sites, n.x, n.y, n.z, opts); if (s) return { node: n, site: s } }
  return null
}

/**
 * Does a blind straight walk of `dist` blocks along yaw `ang` from `pos` enter a disc? Same heading convention as
 * lavaguard.stepLineSafe (x = -sin(yaw), z = -cos(yaw); yaw 0 walks north). The fatal mover after a corridor refusal
 * is not the pathfinder (both reviews, 16 Sep): explore's fallback walk, which prices nothing, is checked here.
 */
export function lineHitsDeathSite (sites, pos, ang, { dist = 7, ...opts } = {}) {
  if (!sites?.length || !pos || !Number.isFinite(ang)) return null
  const dx = -Math.sin(ang), dz = -Math.cos(ang); const y = Math.floor(pos.y)
  for (let k = 0; k <= dist; k++) { const s = nearDeathSite(sites, pos.x + dx * k, y, pos.z + dz * k, opts); if (s) return s }
  return null
}
