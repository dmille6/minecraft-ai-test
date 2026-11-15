// TOPDOWN-01 (owner 2026-11-15, "Yes, authorize": gather takes ground only from the top). The piece is ONE thing: a bot
// standing on the ground must not tunnel under that ground.
//
// WHY. `gather dirt` matches blocks NAMED dirt, and on a plain those lie under the grass. The bot dug its way to them and
// left the grass standing: a roof over a gap. Measured 11-15 (docs/reports/land-eval-2026-11-14/dirt-loop.md, on main):
// on the showcase the dirt was gone from under the original grass block in 3,103 columns within 48 of home, every bot
// breaking 1,339-1,651 dirt blocks there in a week; on the rehearsal world, with the town's gather rule on from the first
// minute, the same habit moved to the ring just past the town's edge (488 undermined columns in the band 65-70 blocks out
// after 9.7 hours). The gather rule says WHERE ground may be taken. This one says HOW: from the top.
//
// THE RULE: ONE SCAN, BOUNDED BY THE BOT'S OWN FEET (review r4). For a terrain cell c (townground.mjs TERRAIN less its ores)
// and the bot's floored feet height F:
//   - Scan upward from c.y + 1 to F. A cell at or above the bot's feet (c.y >= F) has nothing to scan: never refused as
//     roofed.
//   - No roof block in that span: c is not covered as far as this bot is concerned (go on to the pitted test).
//   - A roof block at some h <= F: let t be the top of the contiguous run of roof blocks that starts there. t > F (the
//     cover rises above the bot: it is below it, in a hole, a cave, a mine) -> TAKEN, as the base takes it. t <= F -> REFUSED.
//   So a cell is refused as roofed only when a cover over it tops out at or below the bot's feet. A bot on the lawn is
//   refused the dirt under the grass AT ANY DEPTH (the base already skips fully enclosed targets, and `mine` is the skill
//   for going down); a bot in a 1-deep scrape is refused the dirt under the neighbouring grass; a bot in a hole 2 or more
//   deep takes its walls; a miner takes the rock around it; a bot in a cave takes the cave; a bot on the lawn above a cave
//   is refused the cave's walls and floor. There is no depth constant.
//
// NO SHAFTS (pitted). Once the grass is dug the dirt under it lies open; taking that, then the next, sinks a pit. An
// uncovered cell with 2 or more of its four sides higher (GROUND -- a terrain roof block -- at c.y + 1; a fence, planks or
// glass is not a higher side) is refused, but only when it lies BELOW
// the bot's feet (F >= c.y + 1): the bot would be deepening a hole at or below its own feet. A bot beside such a cell at its
// own level takes it (a recess in the wall of the hole it stands in). A scrape widens before it deepens.
//
// WHAT IS PROVEN (over a grid in topdown.test.mjs), about HEIGHTS: (i) a cell is refused as roofed only when its cover tops
// out at or below the bot's feet; (ii) a cell is refused as pitted only when it lies below the bot's feet and stands lower
// than ground on two or more sides; (iii) therefore terrain at the bot's own feet level or above is never refused by this
// rule (made ground apart). (iv) This is NOT a proof that the bot can leave: mineflayer-pathfinder's step up needs the rim
// at most 1.2 above the floor (fences and walls count 1.5), two blocks of headroom, and the walk profile cannot dig. A bot
// boxed in at its feet level by blocks that are not terrain relies on the escape reflexes, exactly as before this change.
// THE BOT'S FEET LEVEL IS NOT ALWAYS KNOWN TO THE BLOCK. feetLevels(y, onGround) gives every level it may be at: one level
// while it stands on a full block, or on a path, farmland or soul sand block (a little short of full: floor(y + 0.2)); two
// while it stands on a slab (the level below and the one above), and two while it is in the air or swimming (floor(y) - 1 and
// floor(y): a jump from 71 passes through y 71.0-72.25). A CELL IS REFUSED ONLY WHEN IT IS REFUSED AT EVERY SUCH LEVEL
// (topDownCellAt). Reviews 5 and 6 are why: a margin alone read a jumping bot one level HIGH, and judging it one level low
// was not simply looser either -- with the cover's lowest block exactly at the bot's true level, one level lower finds no
// cover and the pitted test refuses a cell the standing bot takes. Asking every level the bot may be at cannot be stricter
// than the truth, whichever of them is the truth. One helper for the search, the target filter and the swing.
// (Review rounds 1-3 showed that every bot-level notion of "sheltered" -- a trap, a climb remedy, "not from below",
// a pit test by the walls round the bot, a head-height comparison -- produced a dead end or a loop.)
//
// KNOWN LIMIT. On a hillside rising one block a column, a bot at its foot (feet S+1) is refused the first uphill column
// (its grass at S+1 is at the bot's feet) and takes the cells of every column from the second on (their cover rises above
// its feet): a bot can tunnel into a hillside from its foot.
//
// THE REMEDY IS PERFORMED, NOT ADVISED. gather already falls back to any block that YIELDS the item when the exact block
// is not found (skills.mjs gatherRun, `gather_via_source`): for dirt that is the grass block on top, which is open to the
// sky. So a search this rule empties goes on to take the top of the same ground. Leaves are not a roof; a log is.
//
// MADE GROUND IS NEVER A SOURCE, for any bot. farmland and dirt_path are left, also for a cell the clean zone's trap lets
// through: gather's fallback lists them among the blocks that yield dirt, and with this rule it fires far more often. The
// exact search for dirt never matches them (they are reached only as fallback alternates), so this strands no one: a bot
// whose only source in reach is a field ends as the base does when it finds nothing.
//
// A cell the clean zone's trap lets through (cleanzone.mjs gatherTrapAllows) is let through here too, made ground excepted;
// the trap's answer is asked ONCE at the swing, before the zone's line counts it down (review r1 blocker 2). This rule never
// creates or counts a trap. An unread cell is not a roof, and a bot whose feet are unknown is refused nothing as roofed or
// pitted (the rule fails open).
//
// A BOUNDED SEARCH. Where everything near is refused, mineflayer's findBlocks cannot stop early. After `giveUp` in-range
// cells skipped by this rule in one search, the caller abandons that search and keeps only what it had accepted before it
// stopped, asked again through the whole matcher chain; the fallback (the block on top) is asked next, the same way, and
// again when every kept cell proved unusable (a block floating over the lawn). Only
// REFUSALS count: a cell the rule accepts never helps abandon a search (review r4: a read budget that counted accepted cells
// threw away a miner's own tunnel walls). The scan reads at most F - c.y + 1 cells, plus 4 for the pitted test, so the reads
// spent on refusals before a give-up are at most giveUp x (maxDistance + 6); no read budget is needed.
//
// ROWS: `_gather_topdown` op=skip once per gather run that skipped anything and again whenever a search was given up
// (gave_up=1); op=from_below once a run (n= block= lowest_gap=) when it took covered cells from below their cover
// (lowest_gap: the smallest distance from the bot's feet up to the first roof block over a taken cell); op=mode once per
// bot process. SWITCH: TOPDOWN=off|0|false|no -> gather is exactly the base's.
import { isTerrain, TOWN_GROUND_HALF } from './townground.mjs'

export const TOPDOWN = Object.freeze({ pit: 2, giveUp: 256, look: 16 })
const ORE = /_ore$/
const MADE = /^(farmland|dirt_path)$/
const LEAVES = /_leaves$/

/** THE SWITCH: TOPDOWN=off|0|false|no -> off. On by default. Pure. */
export const topDownOn = (env = process.env) => !/^(off|0|false|no)$/i.test(String(env?.TOPDOWN ?? '').trim())

/** Is this block a roof? A full block that is not foliage. `b` is a mineflayer block or null (unread: not a roof). Pure. */
export const isRoofBlock = b => !!b && b.boundingBox === 'block' && !LEAVES.test(String(b.name ?? ''))

/** How many of the cell's four horizontal neighbours have ground at y+1 (the ground beside it stands higher)? Pure.
 *  `solidAt` here is a GROUND reader (topDownCell's groundAt): a fence, a wall, planks, glass or a log is not a higher side. */
export function hemmedIn (solidAt, p) {
  if (!p || typeof solidAt !== 'function') return 0
  const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z)
  let n = 0
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (solidAt(x + dx, y + 1, z + dz)) n++
  return n
}

/** Is this the bottom of a hole: `pit` or more sides higher? -> bool. Pure. */
export const isPitted = (solidAt, p, T = TOPDOWN) => hemmedIn(solidAt, p) >= T.pit

/** Is this made ground (a field, a path)? Pure. */
export const isMadeGround = name => MADE.test(String(name ?? ''))

/**
 * THE SCAN, bounded by the bot's feet F -> null (not covered for this bot) | { h, t }. Pure.
 * h: the lowest roof block in c.y+1 .. F. t: the top of the contiguous run of roof blocks from h, read no higher than F+1
 * (t = F+1 means the cover rises above the bot's feet). Reads at most F - c.y + 1 cells.
 */
export function coverFor (solidAt, p, feetY) {
  if (!p || typeof solidAt !== 'function' || !Number.isFinite(feetY)) return null
  const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z), F = Math.floor(feetY)
  let h = y + 1
  while (h <= F && !solidAt(x, h, z)) h++
  if (h > F) return null
  let t = h
  while (t <= F && solidAt(x, t + 1, z)) t++
  return { h, t }
}

/**
 * The cell's verdict for a bot whose feet are at `feetY` -> null (taken) | { kind: 'made' | 'roofed' | 'pitted' } | { kind:
 * 'under', h } (covered, but the cover rises above the bot: taken, and counted as taken from below). Pure.
 * `groundAt(x, y, z)` -> truthy for a TERRAIN roof block: only ground makes a higher side for the pitted test (review r5).
 */
export function topDownCell (solidAt, p, blockName, feetY, groundAt = solidAt) {
  if (!p || !isTerrain(blockName) || ORE.test(blockName)) return null
  if (isMadeGround(blockName)) return { kind: 'made' }
  if (!Number.isFinite(feetY)) return null
  const F = Math.floor(feetY), y = Math.floor(p.y)
  const c = coverFor(solidAt, p, F)
  if (c) return c.t <= F ? { kind: 'roofed', h: c.h, t: c.t } : { kind: 'under', h: c.h }
  return F >= y + 1 && isPitted(groundAt, p) ? { kind: 'pitted' } : null
}

/** ONE LEVEL FOR A STANDING BOT: floor(y + 0.2). A bot on dirt_path or farmland (y = n + 0.9375), mud or soul sand (n + 0.875)
 *  stands on level n + 1, as on grass. Used by feetLevels and for the telemetry's one number. Pure. */
export const feetLevel = y => Number.isFinite(y) ? Math.floor(y + 0.2) : null
/** EVERY LEVEL THE BOT'S FEET MAY BE AT -> [F, ...] lowest first; [] when the height is unknown. Pure. Standing on a full
 *  block or one a little short of full: one level. On a slab: two. In the air or swimming (onGround === false): two. */
export function feetLevels (y, onGround = true) {
  if (!Number.isFinite(y)) return []
  const lo = Math.floor(y)
  if (onGround === false) return [lo - 1, lo]
  const F = feetLevel(y)
  return F > lo || y === lo ? [F] : [lo, lo + 1]
}
/**
 * THE CELL'S VERDICT FOR A BOT WHOSE FEET MAY BE AT ANY OF `levels` -> what topDownCell gives, chosen so that the cell is
 * refused only when EVERY level refuses it. Pure. Made ground does not depend on the level. No level known: only made
 * ground is refused (the rule fails open). If any level takes the cell, that level's answer is returned (an `under` one
 * first, so the from-below count sees it).
 */
export function topDownCellAt (solidAt, p, blockName, levels, groundAt = solidAt) {
  const ls = Array.isArray(levels) ? levels : [levels]
  const cells = (ls.length ? ls : [null]).map(F => topDownCell(solidAt, p, blockName, F, groundAt))
  const taken = cells.filter(c => !c || c.kind === 'under')
  if (taken.length) return taken.find(c => c) ?? null
  return cells[0]
}
export const topDownVerdict = (solidAt, p, blockName, feetY, groundAt = solidAt) => topDownCell(solidAt, p, blockName, feetY, groundAt)?.kind ?? null

/**
 * Does the rule refuse a cell (topDownCell)? Pure. made: always (every bot, the trap's cells too). roofed and pitted: unless
 * the clean zone's trap lets the cell through. under and null: never.
 */
export function topDownRefusal (cell, { trapLets = false } = {}) {
  if (!cell) return false
  if (cell.kind === 'made') return true
  if (trapLets) return false
  return cell.kind === 'roofed' || cell.kind === 'pitted'
}

/** May gather NOT take this cell, for a bot with feet at `feetY` and no trap? -> bool. Pure. */
export const topDownRefuses = (solidAt, p, blockName, feetY) => topDownRefusal(topDownCell(solidAt, p, blockName, feetY))

/** Has one search skipped enough in-range cells for this rule that it should be abandoned? Only refusals count. Pure. */
export const topDownGiveUp = (skipped, T = TOPDOWN) => skipped >= T.giveUp

/** TELEMETRY ONLY (once per dig): the y of the first roof block over a cell within `look`, or null. Pure. */
export function roofOverY (solidAt, p, T = TOPDOWN) {
  if (!p || typeof solidAt !== 'function') return null
  const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z)
  for (let h = y + 1; h <= y + T.look; h++) if (solidAt(x, h, z)) return h
  return null
}

/** What the run says when the rule emptied its search and nothing that yields the item lay open either. Pure. */
export const topDownRemedy = (blockName, skipped, maxDistance) =>
  `no ${blockName} open to the sky ${maxDistance > 0 ? `within ${maxDistance} blocks` : 'here'} (${skipped} under the ground you stand on left: taking them hollows it). ` +
  `Take ground from the top: gather where it lies open, or \`mine\` to go down for rock (mine digs nothing within 12 blocks of home: walk out at least ${TOWN_GROUND_HALF + 4} blocks from home first)`

/** The `_gather_topdown` licence detail (once per bot process). Pure. */
export const topDownModeDetail = (env = process.env, T = TOPDOWN) => `op=mode on=${topDownOn(env) ? 1 : 0} scan=feet pit=${T.pit} give_up=${T.giveUp}`
