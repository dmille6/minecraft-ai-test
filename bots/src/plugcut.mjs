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
import { isWaterCell, isLavaCell, isFallingBlock, isMeltingIce, overheadBreakRisk, stairUpStep } from './scaffold.mjs'
import { INTERACTIVE } from './poolescape.mjs'

/** PLUGCUT=0 turns the rung off (the one-setting rollback); anything else, or unset, leaves it on. */
export const plugCutOn = (env = typeof process !== 'undefined' ? process.env : {}) => String(env?.PLUGCUT ?? '1') !== '0'
export const PLUG_AFTER_REFUSALS = 3   // the rung runs from the 4th CONSECUTIVE flood refusal (a pinned bot, never a passer-by)
export const PLUG_MAX = 3              // wet faces one cut may plug
export const PLUG_ROUNDS = 3           // plug-and-replan rounds per firing
export const PLUG_CLEAR_UP = 2         // a licensed ramp is not handed back to the planner below this many blocks of climb
export const PLUG_BUDGET_MS = 90_000   // a licensed firing's budget: poolescape's POOL_BUDGET_MS (the unlicensed ramp keeps 60 s)
export const PLUG_STEP_RETRIES = 2     // a licensed step cut but not taken (the body still in its column) is jumped again
export const PLUG_SETTLE_MS = 1200     // after the last plug, the faces are asked again this much later before the cut (Claude r1 P2)

const solid = b => !!b && b.boundingBox === 'block'
const plainWater = b => !!b && /^(water|flowing_water)$/.test(b.name ?? '') && b.isWaterlogged !== true
const key = c => c.join(',')
const OWN = [[0, 0, 0], [0, 1, 0]]                                   // the bot's own feet and head cells: never a plug, never a face

/**
 * The first solid, non-interactive neighbour of `c` (offsets from the feet) to click, below first. A kept cell may be the
 * reference (Codex r1 P2): the climb's cells are kept out of PLACEMENTS, and a solid one -- a step cell about to be cut -- is a
 * reference like any other (the plug stays when it is dug). The bot's own cells are never solid, so they are never clicked.
 */
function faceFor (at, c) {
  for (const [fx, fy, fz] of [[0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]]) {
    const r = [c[0] + fx, c[1] + fy, c[2] + fz]
    const b = at(...r)
    if (solid(b) && !INTERACTIVE.test(b.name ?? '')) return { cell: c, ref: r, face: [-fx, -fy, -fz] }
  }
  return null
}

/**
 * THE PLUGS THAT DRY THE FACES OF ONE CELL ABOUT TO BE BROKEN -> { ok, plugs: [{cell, ref, face}], reason }. Pure.
 *   at(dx,dy,dz)  block relative to the bot's FEET (null = unloaded)
 *   cell          the cell the flood check refused to break
 *   keep          cells a plug must never fill (the bot's own cells, the path the climb will use)
 * Reads exactly the faces the shared flood check reads for an ordinary block (above + the four sides) and refuses every
 * face a block cannot make dry. Does NOT re-ask the flood check; its two callers below do, against the plugged world.
 */
function facePlugs (at, cell, keep) {
  const no = reason => ({ ok: false, plugs: [], reason })
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
    if (keep.has(key(c))) return no(`the wet face ${key(c)} is a cell the climb needs open`)
    const f = faceFor(at, c)
    if (!f) return no(`no face to click for the plug at ${key(c)}`)
    plugs.push(f)
  }
  if (!plugs.length) return no('nothing to plug: the refusal is not a wet face')
  return { ok: true, plugs, reason: null }
}

/** The world as it reads after `plugs` are placed (each a solid block). */
const withPlugs = (at, plugs) => {
  const set = new Set(plugs.map(p => key(p.cell)))
  return (x, y, z) => set.has(key([x, y, z])) ? { name: 'cobblestone', boundingBox: 'block' } : at(x, y, z)
}

/**
 * THE PLUGS THAT MAKE ONE REFUSED CEILING CUT DRY -> { ok, plugs: [{cell, ref, face}], reason }. Pure.
 *   at(dx,dy,dz)  block relative to the bot's FEET (null = unloaded)
 *   cell          the refused cell (the ceiling: [0,2,0])
 *   blocks        placeable, non-falling blocks the bot holds
 *   submerged     the bot's feet and head cells are both water (the flood check's own exemption: nothing to plug for)
 */
export function ceilingPlugPlan ({ at = () => null, cell = [0, 2, 0], blocks = 0, submerged = false } = {}) {
  const no = reason => ({ ok: false, plugs: [], reason })
  if (submerged) return no('submerged: the flood check already exempts water here')
  // THE CELL ABOVE THE CUT IS THE CLIMB'S NEXT CELL, so it is never plugged: water there is a body the bot would climb
  // into (climb-flood-chain scene C, a 3x3x2 pocket over the ceiling) and a plug only moves the refusal up one block.
  const fp = facePlugs(at, cell, new Set([...OWN, [cell[0], cell[1] + 1, cell[2]]].map(key)))
  if (!fp.ok) return fp
  const plugs = fp.plugs
  if (plugs.length > PLUG_MAX) return no(`${plugs.length} wet faces, more than ${PLUG_MAX}`)
  if (blocks < plugs.length) return no(`needs ${plugs.length} block(s) to plug, holds ${blocks}`)
  // AFTER THE PLUGS, WOULD THE SHARED CHECK STILL REFUSE? A plug is never placed for nothing.
  const after = withPlugs(at, plugs)
  const risk = overheadBreakRisk({ at: (x, y, z) => after(cell[0] + x, cell[1] + y, cell[2] + z), submerged })
  if (risk) return no(`plugged, the cut would still be refused: ${risk}`)
  return { ok: true, plugs, reason: null }
}

/** The cells one ramp step along `bear` passes the body through: the bot's own column and the step's three. */
export const stepKeep = bear => [[0, 0, 0], [0, 1, 0], [0, 2, 0], [bear.x, 1, bear.z], [bear.x, 2, bear.z], [bear.x, 3, bear.z]]

/**
 * THE PLUGS THAT LET ONE RAMP STEP ALONG `bear` BE CUT -> { ok, plugs, cells, reason }. Pure.
 *
 * The ceiling is open (the step loop runs only after the breach), but the step's own cells are refused the same way:
 * isolated-c-Alpha, plugged and cut on Paper 2026-10-24, then stopped with every bearing's first step refused, the W and
 * S steps both for ONE flowing-water cell beside their step cell. So this asks the step planner itself (`stairUpStep`,
 * unchanged) what it refuses, plugs the wet faces of THAT cell, and asks again against the plugged world -- up to the
 * step's three dig cells and PLUG_MAX plugs in all. It returns ok only when the step planner, reading the plugged world,
 * accepts the step: a plug is never placed for nothing, and nothing here decides a dig is safe.
 */
export function stepPlugPlan ({ at = () => null, bear, blocks = 0, submerged = false, canBreak = () => true } = {}) {
  const no = reason => ({ ok: false, plugs: [], cells: [], reason })
  if (submerged) return no('submerged: the flood check already exempts water here')
  if (!bear || (!bear.x && !bear.z)) return no('no bearing')
  const keep = new Set(stepKeep(bear).map(key))
  const plugs = [], cells = []
  for (let round = 0; ; round++) {
    const world = withPlugs(at, plugs)
    const step = stairUpStep({ at: world, bear, canBreak, submerged })
    if (step.ok) return plugs.length ? { ok: true, plugs, cells, dig: step.dig, reason: null } : no('nothing to plug: the step is already allowed')
    if (round === 3) return no('the step has more than three cells to dry')     // a step digs at most three cells
    if (!step.flood) return no(plugs.length ? `plugged, the step is still refused: ${step.reason}` : `not a wet refusal: ${step.reason}`)
    const fp = facePlugs(world, step.cell, keep)
    if (!fp.ok) return no(`${step.reason}; ${fp.reason}`)
    plugs.push(...fp.plugs)
    cells.push(step.cell)
    if (plugs.length > PLUG_MAX) return no(`${plugs.length} wet faces, more than ${PLUG_MAX}`)
    if (blocks < plugs.length) return no(`needs ${plugs.length} block(s) to plug, holds ${blocks}`)
  }
}

/**
 * Of `bearings` (preference order), the step that digs out the fewest blocks this firing already placed (`placed`, offsets
 * from the feet: a step through the ceiling's own plug re-digs it -- isolated-c's N bearing on the fixture), then the one that
 * needs the FEWEST plugs, then the order given. Re-digs rank first because they are the dear part: the ramp digs bare-handed,
 * and a bare-handed dig from water with the feet off the ground is 25x the block's grounded price (dirt 18.75 s, cobblestone
 * 250 s), where a placement is one settle (FLOW_SETTLE_MS). Pure.
 */
export function chooseStepPlug ({ bearings = [], placed = [], ...opts } = {}) {
  const mine = new Set(placed.map(key))
  let best = null
  const why = []
  for (const bear of bearings) {
    const r = stepPlugPlan({ ...opts, bear })
    if (!r.ok) { why.push(r.reason); continue }
    const redig = r.dig.filter(c => mine.has(key(c))).length
    if (!best || redig < best.redig || (redig === best.redig && r.plugs.length < best.plugs.length)) best = { ...r, bear, redig }
  }
  return best ?? { ok: false, plugs: [], cells: [], reason: why[0] ?? 'no bearing', bear: null }
}

/**
 * THE RAMP SPARES THIS FIRING'S PLUGS: of `bearings`, those whose first step (`firstDig(bear)` -> its dig cells) digs none of
 * `placed` (offsets from the feet). Paper 10-24 (isolated-c-Alpha, b554b624): plugged, cut, then sank until submerged -- the
 * flood check's own exemption -- and the step loop's longest runway ran N, through the ceiling's plug, which it dug out with
 * water behind it (`_climb_flood_breach ... exempt=1`). The caller falls back to every bearing when the spared ones have no
 * runway, so this only ever reorders a choice that exists. Pure.
 */
export function sparePlugs ({ bearings = [], placed = [], firstDig = () => [], avoid = () => false } = {}) {
  const mine = new Set(placed.map(key))
  // ...AND A UTILITY BLOCK (Claude r1 P3): placebo-d-Delta's W and S steps dig a furnace and a crafting table (bare-handed from
  // water a furnace outlasted its 55 s, Paper probe 1). `avoid(cell)` says which; the same fallback applies.
  return bearings.filter(b => !(firstDig(b) ?? []).some(c => mine.has(key(c)) || avoid(c)))
}

/**
 * THE LICENCE'S OWN STREAK (Codex r1 P1): consecutive flood refusals at ONE place. The arms' `floodRefusals` drives their
 * back-off and survives a recovery by another route (a marooned pillar, poolescape), so three refusals in one pit could
 * license the first refusal in the next. A place is the feet column (x, z) with y within PLUG_STREAK_DY (a bot bobbing in a
 * deep pool moves its feet cell up and down -- Paper 10-24, isolated-d-Bravo 59..61), and a streak lapses after
 * PLUG_STREAK_GAP_MS without a refusal (the back-off curve tops out at 10 min). Pure.
 *   prev   { at: [x,y,z], n, t } | null      at  the floored feet now      now  ms
 * plugSoFar -> the refusals already counted HERE (0 elsewhere or lapsed); plugStreak -> the record after this firing.
 */
export const PLUG_STREAK_DY = 2
export const PLUG_STREAK_GAP_MS = 30 * 60_000
export const plugSamePlace = (prev, at, now) => !!(prev && prev.at && at && prev.at[0] === at[0] && prev.at[2] === at[2] &&
  Math.abs(prev.at[1] - at[1]) <= PLUG_STREAK_DY && now - prev.t <= PLUG_STREAK_GAP_MS)
export const plugSoFar = (prev, at, now) => (plugSamePlace(prev, at, now) ? prev.n : 0)
export function plugStreak (prev, { at, now, refused }) {
  if (!refused) return { at, n: 0, t: now }
  return { at: plugSamePlace(prev, at, now) ? prev.at : at, n: plugSoFar(prev, at, now) + 1, t: now }
}

/** A utility block (poolescape's INTERACTIVE: a furnace, a crafting table, a chest...): never clicked, spared from a first
 *  step's digs where another bearing runs. Re-exported here so reflex.mjs keeps its ONE poolescape import. Pure. */
export const isUtilityBlock = name => INTERACTIVE.test(name ?? '')

/** Is the plug rung due on this flood refusal? When PLUG_AFTER_REFUSALS refusals were already counted HERE. Pure. */
export const plugDue = (soFar, env) => plugCutOn(env) && Number(soFar) >= PLUG_AFTER_REFUSALS

/** The `_plugcut_mode` licence row, once per spawn (index.mjs). Pure. */
export function plugCutModeDetail (env = typeof process !== 'undefined' ? process.env : {}) {
  return `on=${plugCutOn(env) ? 1 : 0} after_refusals=${PLUG_AFTER_REFUSALS} max_plugs=${PLUG_MAX} rounds=${PLUG_ROUNDS} clear_up=${PLUG_CLEAR_UP} budget_s=${PLUG_BUDGET_MS / 1000} step_retries=${PLUG_STEP_RETRIES}`
}
