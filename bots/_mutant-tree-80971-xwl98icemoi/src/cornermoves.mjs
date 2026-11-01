// CORNERWALK-01: NO DIAGONAL STEP ACROSS A BLOCK CORNER ON A WALK.
//
// mineflayer-pathfinder 2.4.5 getMoveDiagonal (movements.js 403-462) prices BOTH side columns of a diagonal step and keeps
// the CHEAPER one: a diagonal is legal when only ONE side is open. The bot's body is 0.6 wide, so a centre-to-centre
// diagonal past a solid side cell clips that cell's corner, and in tight geometry the body wedges (x.3 / z.3 against the
// faces) until the stuck reflex. LIVE showcase 10-28 (shopwalls-02, replayed offline with the pathfinder's own A* on the
// region copy): `21,74,32 -> 20,74,31` as ONE diagonal across the wall corner 21,74,31; 8 of 10 builders wedged there.
// shopwalls-02 fixed the BUILD walk only (buildbot.mjs cornerWaypoints). Upstream: PrismarineJS/mineflayer-pathfinder#310
// ("Bot thinks it can travel diagonally when blocked by other blocks", open); a collaborator's advice there is to drop
// diagonals altogether. oretunnel.mjs already drops them for the 1-wide tunnel.
//
// THE RULE (narrower than dropping diagonals): a diagonal the library offers is kept only when BOTH side columns pass the
// library's OWN side test -- each cell it checks (y and y+1 over the step's base, and y-1 when that cell stands > 1.2 above
// the floor) is `safe` or is one the move itself breaks. Open-field diagonals are unchanged; a corner is walked round by
// two cardinal steps the library already offers. Bound to the SEARCHED Movements (`this.cornerRule`): the walk and its
// walking clones (gather, composter) carry it; the escape profiles (ascend, descend, deck, water) clear it and keep every
// move they had. An own property on `moves`, a plain function (dynamic `this`), installed before the clones copy it
// (index.mjs Object.assign), the same way watermoves.mjs installShoreEgress is.

const k = b => `${b.position.x},${b.position.y},${b.position.z}`

/**
 * THE SIDE TEST -> true when every cell of BOTH side columns passes: `safe`, or broken by the move (`breaks`: a Set of
 * "x,y,z"). Pure over the cells: sides = [[cell, ...], [cell, ...]], a cell { safe, position }. An unread cell fails.
 */
export function sidesClear (sides, breaks = new Set()) {
  for (const col of sides) for (const c of col) if (!c || !(c.safe || (c.position && breaks.has(k(c))))) return false
  return true
}

/** The side cells the library itself checks for a diagonal from `node` along `dir` (movements.js getMoveDiagonal). */
export function diagonalSides (m, node, dir) {
  const y = m.getBlock(node, dir.x, 0, dir.z).physical ? 1 : 0
  const floor = m.getBlock(node, 0, -1, 0)
  const col = (dx, dz) => {
    const out = [m.getBlock(node, dx, y + 1, dz), m.getBlock(node, dx, y, dz)]
    const d = m.getBlock(node, dx, y - 1, dz)
    if (d.height - floor.height > 1.2) out.push(d)
    return out
  }
  return [col(0, dir.z), col(dir.x, 0)]
}

/** Install the rule on one Movements (in place; idempotent). `onRefuse(node, dir)` is told of each refused diagonal. */
export function installCornerRule (movements, { onRefuse = null } = {}) {
  if (!movements || movements.__cornerRule) return movements
  const base = Object.getPrototypeOf(movements).getMoveDiagonal
  movements.getMoveDiagonal = function (node, dir, neighbors) {
    if (!this.cornerRule) return base.call(this, node, dir, neighbors)
    const n0 = neighbors.length
    base.call(this, node, dir, neighbors)
    if (neighbors.length === n0) return
    const mv = neighbors[neighbors.length - 1]
    const breaks = new Set((mv.toBreak ?? []).map(p => `${p.x},${p.y},${p.z}`))
    if (sidesClear(diagonalSides(this, node, dir), breaks)) return
    neighbors.length = n0
    if (onRefuse) { try { onRefuse(node, dir) } catch { /* telemetry only */ } }
  }
  movements.cornerRule = true
  movements.__cornerRule = true
  return movements
}
