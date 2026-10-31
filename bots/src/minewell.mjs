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
//   - nowhere within RELOCATE_RADIUS -> mine looks again within FAR_RADIUS and walks there itself (deterministic);
//   - nowhere reachable -> refuse, naming the well and the cell a `goto` can be pointed at (or the distance).
// And at EVERY dig of the descent (the step, the falling-column re-open, the tread re-dig) the cell is checked again:
// a shell cell is never dug (the stair stops), whatever the plan said.
import { wellBreakCost, bodyInWell } from './well.mjs'

export const RELOCATE_RADIUS = 8
/** The second, longer walk-off when nothing within RELOCATE_RADIUS has a clear stair (mine walks there itself). */
export const FAR_RADIUS = 16
export const MAX_STAIR_STEPS = 90
/** A failed walk-off target rules out the starts within this many blocks of it (horizontally; 1 vertically). */
export const EXCLUDE_NEAR = 2

/** The well column whose SHELL holds this cell -> cap | null. Pure. The same box as wellBreakCost (the pathfinder's). */
export function shellOf (cols, pos) {
  if (!pos || !Array.isArray(cols) || !cols.length) return null
  // wellBreakCost ITSELF, per column, so the stair and the pathfinder can never disagree -- whatever that box grows to
  // (plinth-01 adds the plinth's access stair to it: Claude r3 P2)
  return cols.find(c => wellBreakCost([c], { position: pos }) > 0) ?? null
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
export function stairClear (cols, p0, bear, { maxSteps = MAX_STAIR_STEPS, goalY = null, forbid = null, forbidBottom = null } = {}) {
  const wells = Array.isArray(cols) ? cols : []
  // THE TOWN TREE FARM (treefarm-02 on minewell-01): `forbid(cell)` names the farm's cells a stair must never dig (a plot's
  // soil and column, a torch cell and its floor); `forbidBottom` the lowest of them. Same simulation, same stop rule.
  const farm = typeof forbid === 'function' && Number.isFinite(forbidBottom)
  if (!wells.length && !farm) return { clear: true, hit: null }
  const bottom = Math.min(...wells.map(c => c.y - 3), farm ? forbidBottom : Infinity)
  for (let i = 0; i < maxSteps; i++) {
    if (p0.y - i + 1 < bottom) break
    if (Number.isFinite(goalY) && p0.y - i <= goalY + 1) break   // mine stops there (its loop: y > goalY + 1); Claude r1 P3
    for (const cell of stepCells(p0, bear, i)) {
      const cap = shellOf(wells, cell)
      if (cap) return { clear: false, hit: { step: i, cell, cap } }
      const kind = farm && forbid(cell)
      if (kind) return { clear: false, hit: { step: i, cell, cap: null, farm: true, kind: kind === true ? 'farm' : String(kind) } }
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
/**
 * WHAT A KEEP-OUT HIT PROTECTS, in words. Pure. `forbid` answers true (the farm) or its KIND: 'monument'
 * (structureguard-01), 'town' (townzone-01: the town's ground). The farm's sentence is unchanged.
 */
const KEEP_OUT_WORDS = {
  farm: { label: 'the town tree farm', why: c => `the town tree farm (its soil or a plot at ${c})` },
  monument: { label: 'the town monument (the ziggurat)', why: c => `the town monument (the ziggurat; a reserved cell at ${c})` },
  town: { label: "the town's ground", why: c => `the town's ground (terrain within the town's square around home, at ${c})` },
  // keepout-01 (keepout.mjs): the column above a live fire death site
  lava: { label: 'the column above a marked lava pool (a fire death site)', why: c => `the column above a marked lava pool (a fire death site; a column cell at ${c})` },
  protected: { label: 'a protected zone (scenery)', why: c => `a protected zone (scenery the bots never dig, at ${c})` },   // protectzone-01
  workshop: { label: 'the town workshop', why: c => `the town workshop (a built cell of its record at ${c})` },   // shop-01
  stair: { label: 'the town stair (the mineshaft)', why: c => `the town stair (the mineshaft; a reserved cell at ${c}) -- walk down it instead: mine with a deep y uses it` },   // shaft-02
}
export const keepOutLabel = kind => (KEEP_OUT_WORDS[kind] ?? KEEP_OUT_WORDS.farm).label
export const keepOutWhy = hit => (KEEP_OUT_WORDS[hit?.kind] ?? KEEP_OUT_WORDS.farm).why(`${hit.cell.x},${hit.cell.y},${hit.cell.z}`)
/** A hit's kind: 'well' for a shell, else the keep-out's (a farm hit without a kind is the farm's). Pure. */
export const hitKind = hit => (hit?.cap ? 'well' : hit ? (hit.kind ?? 'farm') : null)

/**
 * COMPOSE KEEP-OUTS for planMineStart (`forbid`, `forbidBottom`) -> { forbid(cell) -> kind | false, bottom }. Pure,
 * VARIADIC (townzone-01 x structureguard-01: one shape, any number of keep-outs -- a two-argument compose would drop a
 * third silently). Each part is { forbid(cell) -> kind | true | null, bottom }; the first part that claims a cell names
 * it; the bottom is the lowest; a part without a forbid is ignored.
 */
export function composeKeepOut (...parts) {
  const live = parts.filter(p => typeof p?.forbid === 'function')
  if (!live.length) return { forbid: null, bottom: null }
  const bots = live.map(p => p.bottom).filter(Number.isFinite)
  return { forbid: c => { for (const p of live) { const k = p.forbid(c); if (k) return k } return false }, bottom: bots.length ? Math.min(...bots) : null }
}

export function planMineStart ({ cols = [], p0, feet = null, bearings = [], standable = () => false, rimStandable = null, radius = RELOCATE_RADIUS, goalY = null, exclude = [], forbid = null, forbidBottom = null, dry = null, far = null } = {}) {
  const wells = Array.isArray(cols) ? cols : []
  const farm = typeof forbid === 'function' && Number.isFinite(forbidBottom)
  if (!wells.length && !farm) return { action: 'go', bearings }
  const inside = bodyInWell(wells, feet ?? { x: p0.x + 0.5, y: p0.y, z: p0.z + 0.5 })
  if (inside) {
    // THE WAY OUT, NAMED (Claude r1 P3): a rim cell beside the column a goto can reach (the pathfinder exempts the bot's own well)
    const rim = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => ({ x: inside.x + dx, y: inside.y + 1, z: inside.z + dz })).find(c => (rimStandable ?? standable)(c))   // a place to walk to, not to mine from (Claude r3 P3)
    return { action: 'refuse', inside: true, cap: inside, to: rim ?? null,
             why: `this bot is inside the junk well at ${inside.x},${inside.y},${inside.z}: a stair from here would dig the well's own floor; ${rim ? `goto ${rim.x} ${rim.y} ${rim.z} (the well's rim) first` : 'climb out to the rim first'}` }
  }
  const clearFrom = from => bearings.filter(b => stairClear(wells, from, b, { goalY, forbid, forbidBottom }).clear)
  // A TARGET THE PATHFINDER FAILED TO REACH, AND ITS NEIGHBOURHOOD (townzone-01: walk-off targets cluster -- the next ring
  // cell beside an unreachable one is unreachable for the same reason, and two tries were spent on one wall): never a
  // start within EXCLUDE_NEAR of it horizontally and 1 vertically
  const failed = (Array.isArray(exclude) ? exclude : []).filter(c => c && Number.isFinite(c.x) && Number.isFinite(c.y) && Number.isFinite(c.z))
  const nearFailed = c => failed.some(e => Math.max(Math.abs(e.x - c.x), Math.abs(e.z - c.z)) <= EXCLUDE_NEAR && Math.abs(e.y - c.y) <= 1)
  const here = clearFrom(p0)
  // WHAT A KEEP-OUT TOOK AWAY (townzone-01): the kinds that block the bearings left out
  const kindsOf = bs => [...new Set(bs.map(b => stairClear(wells, p0, b, { goalY, forbid, forbidBottom }).hit).filter(Boolean).map(hitKind))]
  const isDry = (from, b) => typeof dry !== 'function' || dry(from, b)
  // A KEEP-OUT MUST NOT LEAVE ONLY WET WAYS WHEN IT TOOK A DRY ONE (townzone-01, the zone's water case, Claude r2 P2-e): "water in
  // every other direction" would be false -- the planner walks off instead
  const left = bearings.filter(b => !here.includes(b))
  if (here.length && (here.some(b => isDry(p0, b)) || !left.some(b => isDry(p0, b)))) return { action: 'go', bearings: here, kinds: kindsOf(left) }
  // WHAT BLOCKS, over every bearing (Claude r8 P2: a farm-caused refusal named a far-away well when the town has one)
  const hits = (bearings.length ? bearings : [{ x: 0, z: 1 }]).map(b => stairClear(wells, p0, b, { goalY, forbid, forbidBottom }).hit).filter(Boolean)
  const farmHit = hits.find(h => h.farm) ?? null, wellHit = hits.find(h => h.cap) ?? null
  const hit = wellHit ?? farmHit
  const kinds = [...new Set(hits.map(hitKind))].concat(here.length && !hits.length ? ['water'] : [])
  // A START ALL KEEP-OUTS ALLOW: a stand not in a well column or a keep-out cell, standable, not failed before, with a clear
  // stair that is DRY at its first tread when `dry` is given (a walk-off must not hand the bot to the water refusal)
  const startAt = cell => {
    if (bodyInWell(wells, { x: cell.x + 0.5, y: cell.y, z: cell.z + 0.5 })) return null
    if (farm && (forbid(cell) || forbid({ x: cell.x, y: cell.y + 1, z: cell.z }))) return null
    if (nearFailed(cell)) return null
    if (!standable(cell)) return null
    const ok = clearFrom(cell)
    return ok.length && ok.some(b => isDry(cell, b)) ? ok : null
  }
  // never a feet cell inside a well column (its stand on the rim is fine: the stair from it is what is simulated); never a
  // stand in a keep-out cell (the head check is belt and braces); never a target the pathfinder already failed to reach
  for (const c of relocateCandidates(p0, radius)) {
    const cell = { x: c.x, y: c.y, z: c.z }
    const ok = startAt(cell)
    if (ok) return { action: 'relocate', to: cell, bearings: ok, hit, kinds, ...(farmHit ? { farm: true, kind: farmHit.kind ?? 'farm' } : {}) }
  }
  // THEN THE FAR STARTS a keep-out names (townzone-01: cells just beyond the town's square, which no ring within FAR_RADIUS
  // of a bot inside it reaches) -- judged by the SAME test, so the one target satisfies every keep-out at once. Lazy: asked
  // only when the rings found nothing, and told what blocked (`far(kinds)`), so a keep-out offers its starts only when it
  // is the one in the way -- a well alone keeps minewell's own two walks exactly.
  let farCells = []
  try { farCells = (typeof far === 'function' ? far(kinds) : far) ?? [] } catch { farCells = [] }
  for (const c of Array.isArray(farCells) ? farCells : []) {
    const cell = { x: c.x, y: c.y, z: c.z }
    const ok = startAt(cell)
    if (ok) return { action: 'relocate', to: cell, bearings: ok, hit, kinds, far: true, ...(farmHit ? { farm: true, kind: farmHit.kind ?? 'farm' } : {}) }
  }
  const farmWhy = farmHit ? keepOutWhy(farmHit) : null
  // THE WORDS (Codex comp r2 P3): when some stairs from here ARE clear but only wet (the dry rule), never claim that every
  // stair digs the keep-out -- each is either blocked or meets water at its first tread
  const blockedOrWet = what => here.length
    ? `no stair from here or from any standable cell within ${radius} is both clear of ${what} and dry at its first tread`
    : `every stair from here and from every standable cell within ${radius} would dig ${what}`
  if (farmHit && !wellHit) return { action: 'refuse', cap: null, farm: true, kind: farmHit.kind ?? 'farm', kinds, hit: farmHit, why: blockedOrWet(farmWhy) }
  const cap = wellHit?.cap ?? wells[0] ?? null
  if (!cap) return { action: 'refuse', cap: null, farm: !!farm, kinds, why: here.length ? `every clear stair from here meets water at its first tread, and no standable cell within ${radius} has a dry one` : `no stair from here or from any standable cell within ${radius} is clear` }   // (4 bearings: the second is unreachable in production; Claude r10 P3)
  return { action: 'refuse', cap, kinds, ...(farmHit ? { farm: true, kind: farmHit.kind ?? 'farm' } : {}), why: blockedOrWet(`the junk well's shell at ${cap.x},${cap.y},${cap.z}${farmWhy ? ` or ${farmWhy}` : ''}`) }
}
