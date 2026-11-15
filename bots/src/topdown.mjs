// TOPDOWN-01 (owner 2026-11-15, "Yes, authorize": gather takes ground only from the top).
//
// WHY. `gather dirt` matches blocks NAMED dirt, and on a plain those lie under the grass. The bot dug its way to them and
// left the grass standing: a roof over a gap. Measured 11-15 (docs/reports/land-eval-2026-11-14/dirt-loop.md, on main):
// on the showcase the dirt was gone from under the original grass block in 3,103 columns within 48 of home, every bot
// breaking 1,339-1,651 dirt blocks there in a week; on the rehearsal world, with the town's gather rule on from the first
// minute, the same habit moved to the ring just past the town's edge (488 undermined columns in the band 65-70 blocks out
// after 9.7 hours). The gather rule says WHERE ground may be taken. This one says HOW: from the top.
//
// THE RULE. A terrain block (townground.mjs TERRAIN less its ores) is not a gather target while it is UNDER A ROOF NEAR
// THE SURFACE:
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
// MADE GROUND IS NOT A SOURCE. farmland and dirt_path are left open or not: gather's fallback lists them among the blocks
// that yield dirt, and with this rule it fires far more often; outside the town square it would dig up a field or a path.
//
// A BOT THAT CANNOT LEAVE WHERE IT STANDS KEEPS ITS WAY OUT: a cell the clean zone's trap lets through (cleanzone.mjs
// gatherTrapAllows) is let through here too, by the caller, and a cell only this rule refuses counts against the trap's
// cells at the swing, as the clean zone's do (topDownTrapCounts). An unread cell above is not a roof (the rule fails open).
//
// A BOUNDED SEARCH. Where everything near is roofed, mineflayer's findBlocks cannot stop early and reads every cell of
// every section in range. After `giveUp` in-range cells skipped by this rule in one search, the caller abandons that search
// and keeps only what it had accepted before it stopped (the nearest 32). Where everything near is roofed that is nothing,
// so the fallback (the block on top) is asked next, the same way. An abandoned search can miss open ground farther out.
// ROWS: `_gather_topdown` once per gather run that skipped anything (op=skip, with gave_up=1 when a search was abandoned)
// and once per bot process (op=mode).
// SWITCH: TOPDOWN=off|0|false|no -> gather is exactly the base's.
import { isTerrain } from './townground.mjs'

export const TOPDOWN = Object.freeze({ deep: 8, air: 16, pit: 2, giveUp: 256 })
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
export function coverOf (solidAt, p, T = TOPDOWN) {
  if (!p || typeof solidAt !== 'function') return 'open'
  const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z)
  let n = 0
  while (n < T.deep && solidAt(x, y + 1 + n, z)) n++
  if (n >= T.deep) return 'deep'
  if (n > 0) return 'roofed'
  for (let g = 1; g <= T.air; g++) {
    if (!solidAt(x, y + 1 + g, z)) continue
    let t = 0
    while (t < T.deep && solidAt(x, y + 1 + g + t, z)) t++
    return t >= T.deep ? 'deep' : 'roofed'
  }
  return 'open'
}

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
 * May gather NOT take this cell? -> bool. Pure. Only terrain, never an ore (the ore tunnel has its own price), a log or a crop.
 * Refused: made ground, always; a roofed cell; an open cell at the bottom of a hole (pitted). Taken: deep, and open level ground.
 */
export function topDownRefuses (solidAt, p, blockName, T = TOPDOWN) {
  if (!p || !isTerrain(blockName) || ORE.test(blockName)) return false
  if (isMadeGround(blockName)) return true
  const cover = coverOf(solidAt, p, T)
  if (cover === 'roofed') return true
  return cover === 'open' && isPitted(solidAt, p, T)
}

/** At the swing, does this cell count against the trap? Only when the trap lets it through, this rule refuses it, and the
 *  clean zone does not (the zone's own line counted it already). Pure. */
export const topDownTrapCounts = (trapLets, topRefuses, zoneRefuses) => !!trapLets && !!topRefuses && !zoneRefuses

/** Has one search skipped enough in-range cells for this rule that it should be abandoned? Pure. */
export const topDownGiveUp = (skipped, T = TOPDOWN) => skipped >= T.giveUp

/** What the run says when the rule emptied its search and nothing that yields the item lay open either. Pure. */
export const topDownRemedy = (blockName, skipped, maxDistance) =>
  `no ${blockName} open to the sky ${maxDistance > 0 ? `within ${maxDistance} blocks` : 'here'} (${skipped} under a roof near the surface left: taking them hollows the ground). ` +
  'Take ground from the top: gather where it lies open, or `mine` to go down for rock'

/** The `_gather_topdown` licence detail (once per bot process). Pure. */
export const topDownModeDetail = (env = process.env, T = TOPDOWN) => `op=mode on=${topDownOn(env) ? 1 : 0} deep=${T.deep} air=${T.air} pit=${T.pit} give_up=${T.giveUp}`
