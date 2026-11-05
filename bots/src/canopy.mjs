// CANOPY-01: A TREE THAT GREW ON OR AGAINST A BUILD IS CUT BACK SO A STAND SEES THE CELL (fleet 11-05, stuckproj-01).
//
// THE CASES (fleet aea83708, 11-05 ~19:20Z; world read from the region files, stands replayed offline with buildsite.mjs walkFrom /
// stepFor on those copies -- BEFORE: no stand for any of the four):
//   hive-d monument    L01-W 13,65,84 (air) -- a spruce grew in the layer; spruce_leaves over the cell and on every approach.
//                      stuck_on_cell 21 h, 3,625 open cells wait on it, 'nothing else is open: STALLED'.
//   placebo-c monument L00-W 294,70,107 (air) -- an oak's canopy round it; 5,311 cells wait.
//   isolated-a monument L00-S 296,70,121 (air, + 3 more) -- an oak canopy over the skin.
//   isolated-a wall    W-02 383,80,191 (air, + 2 more) -- an oak grew against the wall; its 12-cell waiver is SPENT (all 12 on
//                      this one tree's side), 251/255 built.
//   isolated-c monument L02-N: 5 oak_leaves IN record cells, clear_failed no_stand x370 each in 3 h (the canopy round them).
// Every remedy the visit has refuses these, each correctly: the stand search needs a clear sight line (leaves are full blocks to
// it), the void access digs only this record's DONE cells (`dig_not_record`), the waiver hides only foundation/core cells (these
// are SKIN) and the wall's is bounded, and the foreign clear digs only the cell's own block. Leaves are the one thing between.
//
// THE REMEDY (pure here; the actuator is buildrun.mjs runVisit `p.canopy`): when a cell has no stand this visit -- a foreign
// block in an open cell whose dig found none, or placeable cells no stand reaches -- the NATURAL leaves (persistent=false: grown,
// never placed) and vines round it are dug, highest first, each from a dig stand like every clear; then the cell is tried again.
// Never a record cell that reads done, never another project's record cell, never a protected zone (`mayDig`). Replayed on the
// four region copies: canopy 24 / 77 / 121 / 47 blocks, all reachable from outside in, and AFTER every cell has a stand.
// Bounded: CANOPY_MAX digs a visit, each cell's canopy cut once a visit. CANOPY=off is the rollback: every visit as before.

const kOf = a => `${a[0]},${a[1]},${a[2]}`
const nm = b => String(b?.name ?? '').replace(/\[.*\]$/, '')

export const canopyOn = (env = process.env) => !['off', '0', 'false', 'no'].includes(String(env?.CANOPY ?? '').trim().toLowerCase())
export const CANOPY_R = 3            // horizontal (Chebyshev) reach of the cut round the cell: a stand is within REACH 4.5 of its face
export const CANOPY_DOWN = 1         // ...from one below the cell
export const CANOPY_UP = 3           // ...to three above it (a stand's head and the sight line over the cell)
export const CANOPY_MAX = 48         // digs a visit (the replay's largest canopy, 121, is three visits)

/** A block the canopy may cut, by NAME: leaves or a vine. The caller's `natural(at)` decides the rest (a leaf's persistent=false). */
export const CANOPY_NAME = /^([a-z_]+_leaves|vine|glow_lichen)$/

/** A mineflayer block's properties say NATURAL leaves (persistent false; a vine or lichen has no such property: natural). Pure. */
export function naturalProps (name, props) {
  const n = nm({ name })
  if (!CANOPY_NAME.test(n)) return false
  if (!/_leaves$/.test(n)) return true
  const p = props?.persistent
  return p === false || p === 'false'
}

/**
 * THE CANOPY ROUND A CELL -> [{ at, name }] highest first, then nearest the cell. Pure.
 *   cell        [x, y, z] the cell no stand reaches
 *   read        (x, y, z) -> { name } | null (unread: never cut)
 *   natural     at -> the block there is natural leaves / a vine (the caller reads its properties)
 *   mayDig      at -> false never digs (another project's record cell, a protected zone)
 *   recordCell  key -> THIS record's cell there | null
 *   isDone      c -> the record cell reads done (a done cell is never dug: it is the build)
 *   skip        key -> already cut / tried this visit
 */
export function canopyCuts (cell, { read, natural = () => false, mayDig = () => true, recordCell = () => null, isDone = () => false, skip = () => false, r = CANOPY_R, down = CANOPY_DOWN, up = CANOPY_UP } = {}) {
  if (!Array.isArray(cell) || cell.length < 3 || typeof read !== 'function') return []
  const out = []
  for (let dy = up; dy >= -down; dy--) {
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      const at = [cell[0] + dx, cell[1] + dy, cell[2] + dz]
      const k = kOf(at)
      if (skip(k)) continue
      const b = read(...at)
      if (!b || !CANOPY_NAME.test(nm(b))) continue
      const c = recordCell(k)
      if (c && isDone(c)) continue
      if (!natural(at) || !mayDig(at)) continue
      out.push({ at, name: nm(b), d: Math.abs(dx) + Math.abs(dz) })
    }
  }
  out.sort((a, b) => b.at[1] - a.at[1] || a.d - b.d)
  return out.map(({ at, name }) => ({ at, name }))
}
