// MINE KEEPS OUT OF THE JUNK WELL'S SHELL (minewell-01). Pure: the caller supplies the known well columns and a cell reader.
//
// WHY (10-14 21:32-21:36Z, hive-d, base build 5e66386): hive-d-Echo disposed 189 items from its town well's stand
// (79,58,77; cap 79,57,76), then ran `mine` from that stand. The staircase dug 79,57,77 and 79,56,77 -- the well's south
// WALL at g and g-1 -- and in the same second the bot, standing in the dug wall cell, collected 8 stacks lying on the
// shaft floor; at 21:35:55 it dug the FLOOR (79,55,76) and one more. `mine` digs with bot.dig() directly, so the well's
// break exclusion (well.mjs wellBreakCost, wired into the pathfinder's Movements only) never applied, and mine's own
// guard is "within 12 of home" (the stand was 14.9 away). The same 9 rows reverted the wellsite-02 canary through a
// mis-scoped read gate; the dig itself is this file's business.
//
// THE SHELL is exactly wellBreakCost's box -- every cell within 2 horizontally of a known well column, from cap.y - 3 up
// to the cap -- so the pathfinder and the stair refuse the same cells. It covers a dug well (walls, floor, the 2-wide
// underground ring) and a raised plinth well alike (plinth-01: cap at s+3 over a 5x5x3 plinth on the surface s =
// cap.y - 3), as long as its cap is a known well column (knownWellCells: a well found by its trapdoor cap, or the
// recorded site). Cells outside the box (a plinth's access stair) are not the shell.
//
// THE RULE, before the first dig:
//   - a body INSIDE a well column never starts a descent there (it would dig its own floor); the remedy is to step out;
//   - the stair is simulated for EVERY bearing from where the bot stands, step by step, until its highest dug cell is
//     below the deepest shell; a bearing is clear only if no cell it would ever dig (the ceiling, headroom and tread of
//     each step) lies in a shell;
//   - a clear bearing from here -> mine uses only clear bearings;
//   - none -> RELOCATE: the nearest standable cell (feet and head open, a solid floor, not in a well column) within
//     RELOCATE_RADIUS from which a bearing is clear; mine walks there and plans again (once);
//   - nowhere -> refuse, naming the well and a cell to walk to if one exists further out.
// And at EVERY dig of the descent (the step, the falling-column re-open, the tread re-dig) the cell is checked again:
// a shell cell is never dug (the stair stops), whatever the plan said.
import { wellBreakCost, bodyInWell } from './well.mjs'

export const RELOCATE_RADIUS = 8
export const MAX_STAIR_STEPS = 90

/** The well column whose SHELL holds this cell -> cap | null. Pure. The same box as wellBreakCost (the pathfinder's). */
export function shellOf (cols, pos) {
  if (!pos || !Array.isArray(cols) || !cols.length) return null
  if (wellBreakCost(cols, { position: pos }) <= 0) return null
  return cols.find(c => Math.abs(pos.x - c.x) <= 2 && Math.abs(pos.z - c.z) <= 2 && pos.y >= c.y - 3 && pos.y <= c.y) ?? null
}

/** The cells step i of a stair from p0 along `bear` digs (skills.mjs descentStepCells: ceiling, headroom, tread). Pure. */
export function stepCells (p0, bear, i) {
  const x = p0.x + bear.x * i, y = p0.y - i, z = p0.z + bear.z * i
  return [{ x: x + bear.x, y: y + 1, z: z + bear.z }, { x: x + bear.x, y, z: z + bear.z }, { x: x + bear.x, y: y - 1, z: z + bear.z }]
}

/**
 * IS THE WHOLE STAIR CLEAR OF EVERY SHELL? -> { clear, hit: { step, cell, cap } | null }. Pure. Simulated until the
 * step's highest dug cell (its ceiling, y0 - i + 1) is below the deepest shell (min cap.y - 3), or `maxSteps`.
 */
export function stairClear (cols, p0, bear, { maxSteps = MAX_STAIR_STEPS } = {}) {
  if (!Array.isArray(cols) || !cols.length) return { clear: true, hit: null }
  const bottom = Math.min(...cols.map(c => c.y - 3))
  for (let i = 0; i < maxSteps; i++) {
    if (p0.y - i + 1 < bottom) break
    for (const cell of stepCells(p0, bear, i)) {
      const cap = shellOf(cols, cell)
      if (cap) return { clear: false, hit: { step: i, cell, cap } }
    }
  }
  return { clear: true, hit: null }
}

/** Candidate cells around p0 (same y, then one up/down), nearest first, within `radius` (Chebyshev rings). Pure. */
export function relocateCandidates (p0, radius = RELOCATE_RADIUS) {
  const out = []
  for (let r = 1; r <= radius; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue
        for (const dy of [0, 1, -1]) out.push({ x: p0.x + dx, y: p0.y + dy, z: p0.z + dz, d: Math.hypot(dx, dz) + Math.abs(dy) * 0.5 })
      }
    }
  }
  return out.sort((a, b) => a.d - b.d || a.x - b.x || a.z - b.z || a.y - b.y)
}

/**
 * WHERE AND HOW `mine` MAY START -> one of
 *   { action: 'go', bearings }                 clear bearings from here (all of them when no well is known)
 *   { action: 'relocate', to, bearings, hit }  walk to `to` first; from there these bearings are clear
 *   { action: 'refuse', why, cap }             inside a well, or no clear start within the radius
 * Pure.
 *   cols       known well columns (caps)
 *   p0         the bot's feet cell (integers);  feet  its exact feet position (for "inside a well")
 *   bearings   the stair's candidate cardinals (skills.mjs stairBearings)
 *   standable  (cell) -> bool: feet and head open, a solid floor (the caller reads the world)
 */
export function planMineStart ({ cols = [], p0, feet = null, bearings = [], standable = () => false, radius = RELOCATE_RADIUS } = {}) {
  const wells = Array.isArray(cols) ? cols : []
  if (!wells.length) return { action: 'go', bearings }
  const inside = bodyInWell(wells, feet ?? { x: p0.x + 0.5, y: p0.y, z: p0.z + 0.5 })
  if (inside) {
    return { action: 'refuse', cap: inside, why: `this bot is inside the junk well at ${inside.x},${inside.y},${inside.z}: a stair from here would dig the well's own floor; climb out to the stand first` }
  }
  const clearFrom = from => bearings.filter(b => stairClear(wells, from, b).clear)
  const here = clearFrom(p0)
  if (here.length) return { action: 'go', bearings: here }
  const hit = stairClear(wells, p0, bearings[0] ?? { x: 0, z: 1 }).hit
  for (const c of relocateCandidates(p0, radius)) {
    const cell = { x: c.x, y: c.y, z: c.z }
    // never a feet cell inside a well column (its stand on the rim is fine: the stair from it is what is simulated)
    if (bodyInWell(wells, { x: c.x + 0.5, y: c.y, z: c.z + 0.5 })) continue
    if (!standable(cell)) continue
    const ok = clearFrom(cell)
    if (ok.length) return { action: 'relocate', to: cell, bearings: ok, hit }
  }
  const cap = hit?.cap ?? wells[0]
  return { action: 'refuse', cap, why: `every stair from here and from every standable cell within ${radius} would dig the junk well's shell at ${cap.x},${cap.y},${cap.z}; walk at least ${radius + 3} blocks away from it and mine there` }
}
