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
// THE RULE. A terrain block (townground.mjs TERRAIN less its ores) is not a gather target while it is
// UNDER A ROOF NEAR THE SURFACE:
//   open    nothing solid above it within `air` cells: it lies open to the sky. TAKEN.
//   deep    `deep` or more solid blocks lie over it (straight above, or as the roof of the space it floors): that is a
//           mine or a deep cave, where taking rock is what the bot is there for. TAKEN.
//   roofed  anything else: a few blocks under the surface, or the floor or wall of a shallow hollow. NOT TAKEN.
// `deep` is 8, the same depth the ground ledger (scripts/host/groundledger.py) uses to tell surface damage from mining,
// so what this rule refuses is what the ledger would count as `undermined`.
//
// THE REMEDY IS PERFORMED, NOT ADVISED. gather already falls back to any block that YIELDS the item when the exact block
// is not found (skills.mjs gatherRun, `gather_via_source`): for dirt that is the grass block on top, which is open to the
// sky. So a search this rule empties goes on to take the top of the same ground, and the column is opened from above:
// a scrape that can be seen and filled, not a hollow. Leaves are not a roof (ground under a canopy is open); a log is.
//
// NO SHAFTS. Once the grass is dug the dirt under it lies open, and taking that, then the next, sinks a 1x1 pit to the
// stone: a pit traps bots, which is the loop this piece exists to break. So an open cell is still left when the ground
// beside it stands higher on two or more of its four sides (a roof block at y+1 in x+-1 or z+-1): `pitted`. A scrape
// widens before it deepens: the centre of a scraped patch (no higher side) and its edges (one) are taken, its corners
// (two) are not. A deep cell is never pitted: in a mine the deep verdict wins.
//
// MADE GROUND IS NEVER A SOURCE, for any bot. farmland and dirt_path are left open or not, by a bot below its cover too and
// for a cell the clean zone's trap lets through: gather's fallback lists them among the blocks that yield dirt, and with this rule
// it fires far more often; outside the town square it would dig up a field or a path. The exact search for dirt never
// matches them (they are reached only as fallback alternates), so this can strand no one: a bot whose only source in reach
// is a field ends as the base does when it finds nothing.
//
// WHO IS REFUSED: ONE HEIGHT COMPARISON PER CELL (review r3). A roofed cell is refused only while the bot's head reaches the
// surface over it: refuse iff feetY + 1 >= coverTopY(cell), the top of what covers the cell. When the bot is lower than that,
// the cell is taken exactly as the base takes it. WHY THIS IS THE RIGHT INVARIANT: the rule exists to stop a bot standing on
// the ground from tunnelling under that ground. A bot whose head is below the surface over a cell is already down a hole, a
// cave or a mine relative to that cell; refusing it there protects nothing and can strand it. And when a cell IS refused,
// the bot's head is at or above the surface over it, so it is at most one block down: it can step out, and a drop on the rim
// is within its reach. So no refusal can strand. (Two rounds of review showed that every bot-level notion of "sheltered" --
// a trap, a climb remedy, "not from below", a pit test by the walls round the bot -- produced a dead end or a loop: a 2x2 pit
// had only two walls round each of its cells, so its bot was "in the open" and broke rim grass it could not reach.)
// pitted (an OPEN cell with 2+ sides higher) and made ground are refused for every bot. What a bot still takes from below
// a cover is COUNTED (op=from_below n= lowest_gap=, once a run) to size what undermining is left.
// KNOWN LIMIT: on a slope the cover over a cell in the hillside is the hill above it, so a bot at the foot takes cells whose
// cover's top is 2 or more above its feet -- it can tunnel into a hillside that way (see the slope test).
//
// A cell the clean zone's trap lets through (cleanzone.mjs gatherTrapAllows) is let through here too, made ground excepted;
// the trap's answer is asked ONCE at the swing, before the zone's line counts it down (review r1 blocker 2). This rule never
// creates or counts a trap. An unread cell above is not a roof (the rule fails open).
//
// A BOUNDED SEARCH. Where everything near is roofed, mineflayer's findBlocks cannot stop early and reads every cell of
// every section in range. After `giveUp` in-range cells skipped by this rule in one search, or `readBudget` of the rule's
// block reads (inside a deep stone mass every cell is a takeable mine cell, nothing is skipped, and each verdict reads 8
// blocks), the caller abandons that search and keeps only what it had accepted before it stopped, asked again through the
// whole matcher chain. Where everything near is roofed that is nothing, so the fallback (the block on top) is asked next,
// the same way. An abandoned search can miss open ground farther out.
//
// ROWS: `_gather_topdown` once per gather run that skipped anything (op=skip, gave_up=1 when a search was abandoned),
// op=from_below once a run when it took roofed cells from below their cover, and once per bot process (op=mode).
// SWITCH: TOPDOWN=off|0|false|no -> gather is exactly the base's.
import { isTerrain, TOWN_GROUND_HALF } from './townground.mjs'

export const TOPDOWN = Object.freeze({ deep: 8, air: 16, pit: 2, giveUp: 256, readBudget: 16384 })
const ORE = /_ore$/
const MADE = /^(farmland|dirt_path)$/
const LEAVES = /_leaves$/

/** THE SWITCH: TOPDOWN=off|0|false|no -> off. On by default. Pure. */
export const topDownOn = (env = process.env) => !/^(off|0|false|no)$/i.test(String(env?.TOPDOWN ?? '').trim())

/** Is this block a roof? A full block that is not foliage. `b` is a mineflayer block or null (unread: not a roof). Pure. */
export const isRoofBlock = b => !!b && b.boundingBox === 'block' && !LEAVES.test(String(b.name ?? ''))

/**
 * WHAT LIES OVER A CELL -> 'open' | 'deep' | 'roofed'. Pure. `solidAt(x, y, z)` -> truthy when a roof block is there.
 * Straight above: `deep` or more solid cells in a row -> deep; one to deep-1, then a gap -> roofed. Nothing solid straight
 * above: look up through at most `air` empty cells; no roof -> open; a roof `deep` or more thick -> deep; thinner -> roofed.
 */
export const coverOf = (solidAt, p, T = TOPDOWN) => coverScan(solidAt, p, T).cover

/** coverOf's scan -> { cover, top }: `top` is the y of the top block of what covers a ROOFED cell (else null). Pure. */
function coverScan (solidAt, p, T = TOPDOWN) {
  if (!p || typeof solidAt !== 'function') return { cover: 'open', top: null }
  const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z)
  let n = 0
  while (n < T.deep && solidAt(x, y + 1 + n, z)) n++
  if (n >= T.deep) return { cover: 'deep', top: null }
  if (n > 0) return { cover: 'roofed', top: y + n }
  for (let g = 1; g <= T.air; g++) {
    if (!solidAt(x, y + 1 + g, z)) continue
    let t = 0
    while (t < T.deep && solidAt(x, y + 1 + g + t, z)) t++
    return t >= T.deep ? { cover: 'deep', top: null } : { cover: 'roofed', top: y + g + t }
  }
  return { cover: 'open', top: null }
}

/** For a ROOFED cell: the y of the top block of what covers it -- the top of the solid run straight above, or of the roof over
 *  the air above it. null for an open or deep cell. Pure. */
export const coverTopY = (solidAt, p, T = TOPDOWN) => coverScan(solidAt, p, T).top

/** How many of the cell's four horizontal neighbours have a roof block at y+1 (the ground beside it stands higher)? Pure. */
export function hemmedIn (solidAt, p) {
  if (!p || typeof solidAt !== 'function') return 0
  const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z)
  let n = 0
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (solidAt(x + dx, y + 1, z + dz)) n++
  return n
}

/** Is this the bottom of a hole: open above, and `pit` or more sides higher? -> bool. Pure. (A deep cell is not open.) */
export const isPitted = (solidAt, p, T = TOPDOWN) => hemmedIn(solidAt, p) >= T.pit

/** Is this made ground (a field, a path)? Pure. */
export const isMadeGround = name => MADE.test(String(name ?? ''))

/**
 * May gather NOT take this cell, for a bot in the open with no trap? -> bool. Pure. Only terrain, never an ore (the ore tunnel
 * has its own price), a log or a crop. Refused: made ground; a roofed cell; an open cell at the bottom of a hole (pitted).
 * Taken: deep, and open level ground. (topDownVerdict + topDownRefusal give the answer for any bot.)
 */
export const topDownRefuses = (solidAt, p, blockName, T = TOPDOWN) => topDownVerdict(solidAt, p, blockName, T) != null

/** Has one search skipped enough in-range cells for this rule, or read enough blocks for it, that it should be abandoned? Pure. */
export const topDownGiveUp = (skipped, T = TOPDOWN, reads = 0) => skipped >= T.giveUp || reads >= T.readBudget

/**
 * The cell's verdict under this rule -> null (taken) | { kind: 'made' } | { kind: 'pitted' } | { kind: 'roofed', top }. Pure.
 * made: farmland or dirt_path. pitted: open, at the bottom of a hole (2+ sides higher). roofed: `top` is coverTopY.
 */
export function topDownCell (solidAt, p, blockName, T = TOPDOWN) {
  if (!p || !isTerrain(blockName) || ORE.test(blockName)) return null
  if (isMadeGround(blockName)) return { kind: 'made' }
  const { cover, top } = coverScan(solidAt, p, T)
  if (cover === 'roofed') return { kind: 'roofed', top }
  return cover === 'open' && isPitted(solidAt, p, T) ? { kind: 'pitted' } : null
}
export const topDownVerdict = (solidAt, p, blockName, T = TOPDOWN) => topDownCell(solidAt, p, blockName, T)?.kind ?? null

/** Is the bot (feet at `feetY`) below the cover of a roofed cell whose cover's top is `top`: its head under that surface? Pure. */
export const belowCover = (feetY, top) => Number.isFinite(feetY) && Number.isFinite(top) && feetY + 1 < top

/**
 * Does the rule refuse a cell (topDownCell) for a bot whose feet are at `feetY`? Pure.
 * made: always (every bot, the trap's cells too). pitted: unless the clean zone's trap lets the cell through. roofed: unless
 * the trap lets it through, or the bot stands BELOW its cover (belowCover: its head under the surface over the cell).
 */
export function topDownRefusal (cell, { feetY = null, trapLets = false } = {}) {
  if (!cell) return false
  if (cell.kind === 'made') return true
  if (trapLets) return false
  if (cell.kind === 'pitted') return true
  return cell.kind === 'roofed' && !belowCover(feetY, cell.top)
}

/** What the run says when the rule emptied its search and nothing that yields the item lay open either. Pure. */
export const topDownRemedy = (blockName, skipped, maxDistance) =>
  `no ${blockName} open to the sky ${maxDistance > 0 ? `within ${maxDistance} blocks` : 'here'} (${skipped} under a roof near the surface left: taking them hollows the ground). ` +
  `Take ground from the top: gather where it lies open, or \`mine\` to go down for rock (mine digs nothing within 12 blocks of home: walk out at least ${TOWN_GROUND_HALF + 4} blocks from home first)`

/** The `_gather_topdown` licence detail (once per bot process). Pure. */
export const topDownModeDetail = (env = process.env, T = TOPDOWN) => `op=mode on=${topDownOn(env) ? 1 : 0} deep=${T.deep} air=${T.air} pit=${T.pit} give_up=${T.giveUp} reads=${T.readBudget}`
