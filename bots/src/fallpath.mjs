// FALLS: WHAT THE PLANNER HAD JUST ASKED FOR, pure parts (docs/reports/deaths-review-2026-09-16.md §5; queue item
// "falls analysis"). 35 falls in 48 h, median 35 blocks, 21 of them while explore was running, and no record of the
// route being executed when the bot left the ground. Hypothesis to test, not a finding: the pathfinder's default
// `infiniteLiquidDropdownDistance = true` lets a leg drop any height onto a water landing, and a one-block pool or a
// missed landing is a 35-block fall. This module turns the last planned path into three numbers a death row can
// carry: the largest downward step between consecutive nodes, how many of those steps land in liquid, and how many
// exceed the walking planner's own maxDropDown (4). Nothing here touches the bot; `at(x, y, z)` reads a block.
export const WALK_MAX_DROP = 4

const liquid = b => !!b && (b.liquid === true || /water|lava|kelp|seagrass|bubble_column/.test(b.name || ''))

/**
 * Profile a planned path: nodes are {x, y, z} in execution order (the first is where the bot stood).
 * Returns { steps, maxDrop, drops: [{from, to, drop, liquid}], liquidLandings, deepDrops } where a "drop" is any
 * step whose y falls by more than 1 (a walk down a slope is not a drop), `liquid` says the landing cell holds liquid
 * (what the planner believed would break the fall), and deepDrops counts drops beyond WALK_MAX_DROP.
 */
export function pathDropProfile (nodes, at = () => null, { maxDrop = WALK_MAX_DROP } = {}) {
  const out = { steps: 0, maxDrop: 0, drops: [], liquidLandings: 0, deepDrops: 0 }
  if (!Array.isArray(nodes) || nodes.length < 2) return out
  for (let i = 1; i < nodes.length; i++) {
    const a = nodes[i - 1], b = nodes[i]
    if (![a, b].every(n => n && Number.isFinite(n.x) && Number.isFinite(n.y) && Number.isFinite(n.z))) continue
    out.steps++
    const drop = a.y - b.y
    if (drop <= 1) continue
    let landing = null
    try { landing = at(Math.floor(b.x), Math.floor(b.y), Math.floor(b.z)) } catch { landing = null }
    const wet = liquid(landing)
    out.drops.push({ from: [a.x, a.y, a.z], to: [b.x, b.y, b.z], drop, liquid: wet })
    if (drop > out.maxDrop) out.maxDrop = drop
    if (wet) out.liquidLandings++
    if (drop > maxDrop) out.deepDrops++
  }
  return out
}

/** One line for a telemetry detail field. */
export function describeFallPath (last, profile, { now = Date.now() } = {}) {
  if (!last) return 'no planned path on record'
  const age = Math.round((now - (last.t ?? now)) / 1000)
  const d = profile.drops.map(x => `${x.drop}${x.liquid ? 'w' : ''}@${x.to[0]},${x.to[1]},${x.to[2]}`).slice(0, 6).join(' ')
  return `last path ${age}s old (${last.status ?? '?'}, ${profile.steps} steps, profile ${last.profile ?? '?'}): max drop ${profile.maxDrop}, ` +
         `${profile.deepDrops} beyond ${WALK_MAX_DROP}, ${profile.liquidLandings} onto liquid${d ? ` [${d}]` : ''}; goal ${last.goal ?? '?'}`
}
