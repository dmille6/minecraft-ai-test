// PLUGCUT-01: PLUG THE WET FACE, THEN CUT (docs/reports/plugcut-01-design-2026-10-24.md). Pure: no bot.
//
// WHY. OWNER 2026-10-24 (through the coordinator): "plug the wet face first, then cut", reusing poolescape's plug planner;
// a named exception to the no-stuck-hunts rule. The failure-mining library (docs/reports/failmine-2026-10-24.md) holds the
// population: isolated-c-Alpha (356,47,176), placebo-d-Delta (198,34,187) and isolated-d-Bravo (340,60,200), each pinned a
// week in water under a ceiling two blocks above its feet, each through the climb-flood chain: the pillar's head dig and
// the ramp's ceiling breach are refused because ONE face of the ceiling cell holds water (`_climb_flood_guard` "liquid
// beside the block overhead"), every side column is wet ("no dry side column"), and the bot holds 77-645 placeable blocks.
//
// THE REFUSAL IS RIGHT (climbflood-01: the bot's own escape dig was the largest single way into a sealed pocket). What the
// chain lacks is the move a player makes: put a block into the water beside the cell first, so the cut opens onto dry air.
// This file plans exactly that, for the ONE refused cell, and refuses everything it cannot make dry:
//   - the cell itself wet, lava anywhere on its faces, a falling block in or on it, ice, a waterlogged or plant face;
//   - a wet face with no solid, non-interactive block to click (poolescape's faceFor rule, the crafting-table lesson);
//   - more wet faces than PLUG_MAX, or fewer blocks than plugs;
//   - a plan whose simulated result the shared flood check would STILL refuse (`afterPlug`): no plug is placed for nothing.
// The actuator (reflex.mjs escapeStairUp) re-asks this against the live world before every placement and re-checks the
// flood guard on the real cell before the cut; nothing here relaxes the guard.
import { isWaterCell, isLavaCell, isFallingBlock, isMeltingIce, overheadBreakRisk } from './scaffold.mjs'
import { INTERACTIVE } from './poolescape.mjs'

/** PLUGCUT=0 turns the rung off (the one-setting rollback); anything else, or unset, leaves it on. */
export const plugCutOn = (env = typeof process !== 'undefined' ? process.env : {}) => String(env?.PLUGCUT ?? '1') !== '0'
export const PLUG_AFTER_REFUSALS = 3   // the rung runs from the 4th CONSECUTIVE flood refusal (a pinned bot, never a passer-by)
export const PLUG_MAX = 3              // wet faces one cut may plug
export const PLUG_ROUNDS = 3           // plug-and-replan rounds per firing

const solid = b => !!b && b.boundingBox === 'block'
const plainWater = b => !!b && /^(water|flowing_water)$/.test(b.name ?? '') && b.isWaterlogged !== true
const key = c => c.join(',')
const OWN = [[0, 0, 0], [0, 1, 0]]                                   // the bot's own feet and head cells: never a plug, never a face

/** The first solid, non-interactive neighbour of `c` (offsets from the feet) to click, below first; never the bot's cells. */
function faceFor (at, c) {
  for (const [fx, fy, fz] of [[0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]]) {
    const r = [c[0] + fx, c[1] + fy, c[2] + fz]
    if (OWN.some(o => key(o) === key(r))) continue
    const b = at(...r)
    if (solid(b) && !INTERACTIVE.test(b.name ?? '')) return { cell: c, ref: r, face: [-fx, -fy, -fz] }
  }
  return null
}

/**
 * THE PLUGS THAT MAKE ONE REFUSED CUT DRY -> { ok, plugs: [{cell, ref, face}], reason }. Pure.
 *   at(dx,dy,dz)  block relative to the bot's FEET (null = unloaded)
 *   cell          the refused cell (the ceiling: [0,2,0])
 *   blocks        placeable, non-falling blocks the bot holds
 *   submerged     the bot's feet and head cells are both water (the flood check's own exemption: nothing to plug for)
 */
export function ceilingPlugPlan ({ at = () => null, cell = [0, 2, 0], blocks = 0, submerged = false } = {}) {
  const no = reason => ({ ok: false, plugs: [], reason })
  if (submerged) return no('submerged: the flood check already exempts water here')
  const T = at(...cell), above = at(cell[0], cell[1] + 1, cell[2])
  if (!T || !above) return no('terrain not loaded at the cut')
  if (!solid(T) || isWaterCell(T) || isLavaCell(T)) return no(`the cut is not a solid dry block (${T.name})`)
  if (isMeltingIce(T)) return no(`the cut is ice (${T.name})`)
  if (isFallingBlock(T) || isFallingBlock(above)) return no(`a falling block in or on the cut (${isFallingBlock(T) ? T.name : above.name})`)
  const faces = [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]].map(([x, y, z]) => [cell[0] + x, cell[1] + y, cell[2] + z])
  const plugs = []
  for (const c of faces) {
    const n = at(...c)
    if (!n) return no('terrain not loaded beside the cut')
    if (isLavaCell(n)) return no(`lava beside the cut is never plugged (${n.name})`)
    if (isMeltingIce(n)) return no(`ice beside the cut melts into water (${n.name})`)
    if (!isWaterCell(n)) continue
    if (n.isWaterlogged === true) return no(`a waterlogged block beside the cut cannot be plugged (${n.name})`)
    if (!plainWater(n)) return no(`a water plant or bubble column beside the cut cannot be plugged (${n.name})`)
    if (OWN.some(o => key(o) === key(c))) return no('the wet face is the bot\'s own cell')
    const f = faceFor(at, c)
    if (!f) return no(`no face to click for the plug at ${key(c)}`)
    plugs.push(f)
  }
  if (!plugs.length) return no('nothing to plug: the refusal is not a wet face')
  if (plugs.length > PLUG_MAX) return no(`${plugs.length} wet faces, more than ${PLUG_MAX}`)
  if (blocks < plugs.length) return no(`needs ${plugs.length} block(s) to plug, holds ${blocks}`)
  // AFTER THE PLUGS, WOULD THE SHARED CHECK STILL REFUSE? A plug is never placed for nothing.
  const plugged = new Set(plugs.map(p => key(p.cell)))
  const after = (x, y, z) => plugged.has(key([x, y, z])) ? { name: 'cobblestone', boundingBox: 'block' } : at(x, y, z)
  const risk = overheadBreakRisk({ at: (x, y, z) => after(cell[0] + x, cell[1] + y, cell[2] + z), submerged })
  if (risk) return no(`plugged, the cut would still be refused: ${risk}`)
  return { ok: true, plugs, reason: null }
}

/** Is the plug rung due on this flood refusal? From the PLUG_AFTER_REFUSALS-th consecutive one (the arm's own counter). Pure. */
export const plugDue = (refusals, env) => plugCutOn(env) && Number(refusals) >= PLUG_AFTER_REFUSALS

/** The `_plugcut_mode` licence row, once per spawn (index.mjs). Pure. */
export function plugCutModeDetail (env = typeof process !== 'undefined' ? process.env : {}) {
  return `on=${plugCutOn(env) ? 1 : 0} after_refusals=${PLUG_AFTER_REFUSALS} max_plugs=${PLUG_MAX} rounds=${PLUG_ROUNDS}`
}
