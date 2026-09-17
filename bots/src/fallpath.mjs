// FALLS: WHAT THE PLANNER HAD JUST ASKED FOR, pure parts (docs/reports/deaths-review-2026-09-16.md §5; queue item
// "falls analysis"). 35 falls in 48 h, median 35 blocks, 21 of them while explore was running, and no record of the
// route being executed when the bot left the ground. Hypothesis to test, not a finding: the pathfinder's default
// `infiniteLiquidDropdownDistance = true` lets a leg drop any height onto a water landing, and a one-block pool or a
// missed landing is a 35-block fall. This module turns the last planned path into three numbers a death row can
// carry: the largest downward step between consecutive nodes, how many of those steps land in liquid, and how many
// exceed the walking planner's own maxDropDown (4). Nothing here touches the bot; `at(x, y, z)` reads a block.
export const WALK_MAX_DROP = 4

const LAVA = /lava|magma/
const WATER = /water|kelp|seagrass|bubble_column/

/**
 * Profile a planned path: nodes are {x, y, z} in execution order (the first is where the bot stood). `maxDrop` is
 * the planner's OWN maxDropDown at planning time (the walk profile uses 6, descent 8; 4 is the library default).
 * Returns { steps, maxDrop, drops: [{to, drop, land}], liquidLandings, deepDrops, unknownLandings } where a "drop"
 * is any step whose y falls by more than 1, `land` is what the landing cell held WHEN THE PATH WAS PLANNED --
 * 'water', 'lava', 'solid', 'air' or '?' (unloaded; never assumed dry) -- and deepDrops counts drops beyond maxDrop.
 */
export function pathDropProfile (nodes, at = () => null, { maxDrop = WALK_MAX_DROP } = {}) {
  const out = { steps: 0, maxDrop: 0, policy: maxDrop, drops: [], liquidLandings: 0, deepDrops: 0, unknownLandings: 0 }
  if (!Array.isArray(nodes) || nodes.length < 2) return out
  for (let i = 1; i < nodes.length; i++) {
    const a = nodes[i - 1], b = nodes[i]
    if (![a, b].every(n => n && Number.isFinite(n.x) && Number.isFinite(n.y) && Number.isFinite(n.z))) continue
    out.steps++
    const drop = a.y - b.y
    if (drop <= 1) continue
    let cell = null
    try { cell = at(Math.floor(b.x), Math.floor(b.y), Math.floor(b.z)) } catch { cell = null }
    const name = cell?.name
    const land = !name ? '?' : LAVA.test(name) ? 'lava' : (cell.liquid === true || WATER.test(name)) ? 'water' : cell.boundingBox === 'block' ? 'solid' : 'air'
    out.drops.push({ to: [b.x, b.y, b.z], drop, land })
    if (drop > out.maxDrop) out.maxDrop = drop
    if (land === 'water' || land === 'lava') out.liquidLandings++
    if (land === '?') out.unknownLandings++
    if (drop > maxDrop) out.deepDrops++
  }
  return out
}

/** One line, under ~200 characters, for a telemetry detail field. `last` is the record kept at planning time. */
export function describeFallPath (last, { now = Date.now() } = {}) {
  if (!last) return 'no planned path on record'
  const p = last.drops ?? { steps: 0, maxDrop: 0, policy: '?', drops: [], deepDrops: 0, liquidLandings: 0, unknownLandings: 0 }
  const age = Math.round((now - (last.t ?? now)) / 1000)
  const state = last.active === false ? `ended ${Math.round((now - (last.endedAt ?? now)) / 1000)}s ago by ${last.endedBy ?? '?'}` : 'still active'
  const marks = { water: 'w', lava: 'L', solid: 's', air: 'a', '?': '?' }
  const d = p.drops.slice(0, 4).map(x => `${x.drop}${marks[x.land] ?? '?'}@${x.to[0]},${x.to[1]},${x.to[2]}`).join(' ') + (p.drops.length > 4 ? ` +${p.drops.length - 4}` : '')
  return `path ${age}s old, ${state} (${last.status ?? '?'}, ${last.nodes ?? p.steps + 1} nodes, ${last.profile ?? '?'} maxDropDown=${last.maxDropDown ?? '?'} liquidDrop=${last.liquidDropdown ?? '?'}): ` +
         `max drop ${p.maxDrop}, ${p.deepDrops} beyond ${p.policy}, ${p.liquidLandings} onto liquid, ${p.unknownLandings} unknown${d ? ` [${d}]` : ''}; goal ${last.goal ?? '?'}`
}
