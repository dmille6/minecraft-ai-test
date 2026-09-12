// explorestep.mjs -- is a short BLIND walk in a heading safe to take?
//
// explore's leg loop walks forward+jump for 1.2 s after a failed leg, to prove
// to the reflex layer that the bot is not stuck and to start the next plan from
// somewhere else. The pathfinder is not consulted for that walk, so nothing
// prices the ground ahead. Overnight 2026-09-11/12: 13 of 28 fleet deaths
// involved a fall, nearly all during or right after explore; board-a-Echo fell
// 26 blocks at 05:42 after six path timeouts, exactly this branch. In the
// sandbox (synthetic-ledge, 07:00) the probe refused the drop at the platform's
// edge on every leg: "drop deeper than 3 at 304,100,300".
//
// Pure over a blockAt function so the test can hand it a map. It walks the
// heading cell by cell the way the body would (Codex, second pass):
//   - a ONE-high step (solid feet cell, clear above) is climbed by forward+jump,
//     so the probe steps up and keeps going; a two-high obstacle is a wall and
//     ends the walk harmlessly;
//   - the landing under each cell must be within `maxDrop`; a missing floor or
//     lava anywhere in the column refuses;
//   - the body is 0.6 wide and the heading is not axis-aligned, so lava in the
//     two cells beside each probed cell refuses too;
//   - water is terrain (owner directive) and is not refused;
//   - a read that throws refuses: never guess about the ground.
export const BLIND_STEP_BLOCKS = 5      // 1.2 s of forward+jump covers ~4.3 blocks walking, a little more with the jump arc
export const BLIND_STEP_MAX_DROP = 3    // the travel profile's own comfort is maxDropDown 6; a blind step gets half
export const JUMP_CELLS = 3             // a forward jump is airborne for about this many cells

const passable = b => !b || b.name === 'air' || b.boundingBox === 'empty' ||
  b.name === 'water' || b.name === 'cave_air' || b.name === 'void_air'
const lava = b => !!b && /lava/.test(b.name || '')

/**
 * @param {(x:number,y:number,z:number)=>object|null} blockAt  world read
 * @param {{x:number,y:number,z:number}} pos    the bot's EXACT position (x, z fractional; y is floored here)
 * @param {number} yaw   mineflayer yaw (radians); forward = (-sin yaw, -cos yaw)
 * @returns {{ok:boolean, why:string, cells:number}}
 */
export const BODY_HALF_WIDTH = 0.3      // the player's collision box is 0.6 wide

export function blindStepIsSafe (blockAt, pos, yaw, { blocks = BLIND_STEP_BLOCKS, maxDrop = BLIND_STEP_MAX_DROP } = {}) {
  const dx = -Math.sin(yaw), dz = -Math.cos(yaw)
  const side = { x: -dz, z: dx }                 // perpendicular, for the body's width
  // THE FOOTPRINT, NOT A GUESS AT IT. The line is walked from the bot's exact
  // position and the side samples sit at the body's own edges (+-0.3), so a
  // centred bot on a one-wide bridge over lava is not refused for lava its
  // body never touches (Codex, tenth pass), while a diagonal heading whose
  // edges cross into the next column still sees what is there.
  const feet = { x: pos.x, y: Math.floor(pos.y), z: pos.z }
  const read = (x, y, z) => { try { return blockAt(x, y, z) } catch { return undefined } }
  // TWO REFERENCE HEIGHTS, BECAUSE THE BODY'S HEIGHT IS NOT KNOWN. `hi` is the
  // highest the body could be and `lo` the lowest (the start height: never
  // raised, because a jump can clear a narrow step and land lower beyond it;
  // never lowered, because a jump can skip a descending landing). In each cell
  // the body could stand at any height h in [lo, hi+1] whose feet and head
  // cells are both clear (hi+1 is a one-high step taken with the jump). No
  // such height -> a wall at every possible height, and the walk ends
  // harmlessly. Otherwise `hi` becomes the highest such height (Codex, passes
  // four to seven: endpoint tests are not enough; every height is tested).
  // Drops are measured from `hi` (worst case), the lava band spans
  // [lo-1-maxDrop, hi+2] including the two cells beside the line.
  // ...AND AN AIRBORNE BODY LANDS. A forward jump lasts about three cells, so
  // a `hi` carried without a standing candidate at that height for three cells
  // in a row must come down to the highest place the body could stand there
  // (Codex, eighth pass: a gentle staircase of one-block drops is walkable and
  // must not read as one deep fall). Steeper chains still do: two drops of two
  // within the same jump are refused from the carried height.
  let hi = feet.y, lo = feet.y, checked = 0, airborne = 0
  // Lava only matters where the body can touch it. Scanning down a column, a
  // solid block at or below `lo` is a floor under EVERY possible body, so what
  // lies beneath it is out of reach (Codex, ninth pass: lava under an intact
  // floor must not refuse the walk). Solids above `lo` are walls, steps or
  // ceilings the body may be standing under, so they shield nothing.
  const lavaIn = (x, z, top, bot) => {
    for (let y = top; y >= bot; y--) {
      const b = read(x, y, z)
      if (b === undefined) return `cannot read ${x},${y},${z}`
      if (lava(b)) return `lava at ${x},${y},${z}`
      if (!passable(b) && y <= lo) return null                   // a floor under every possible body
    }
    return null
  }
  for (let i = 1; i <= blocks; i++) {
    const cx = Math.floor(feet.x + dx * i), cz = Math.floor(feet.z + dz * i)
    const bad = lavaIn(cx, cz, hi + 2, lo - 1 - maxDrop)
    if (bad) return { ok: false, why: bad, cells: checked }
    // where could the body be in this cell? Either still at `hi` (airborne or
    // walking on, if that body fits) or STANDING at some h in [lo, hi+1]: feet
    // and head clear with a solid under the feet (hi+1 is a one-high step). The
    // new `hi` is the highest of those; none at all is a wall at every height.
    let carried = null, stand = null, lowest = null
    const cell = (y) => { const b = read(cx, y, cz); if (b === undefined) throw new Error(`cannot read ${cx},${y},${cz}`); return b }
    try {
      if (passable(cell(hi)) && passable(cell(hi + 1))) carried = hi
      for (let h = hi + 1; h >= lo - 1 - maxDrop; h--) {
        if (passable(cell(h)) && passable(cell(h + 1)) && !passable(cell(h - 1))) { if (stand === null) stand = h; lowest = h }
      }
    } catch (e) { return { ok: false, why: e.message, cells: checked } }
    if (carried === null && stand === null) return { ok: true, why: `wall after ${checked} cell(s)`, cells: checked }
    if (stand !== null && stand >= hi) { hi = stand; airborne = 0 }          // a landing at or above the carried height
    else if (carried !== null && airborne < JUMP_CELLS) { airborne++ }         // still possibly airborne at hi
    else if (stand !== null) { hi = stand; airborne = 0 }                      // it has landed by now
    else return { ok: true, why: `wall after ${checked} cell(s)`, cells: checked }
    if (lowest !== null && lowest < lo) lo = lowest
    // the landing for the highest possible body: a solid within maxDrop below hi
    let surface = null
    for (let y = hi - 1; y >= hi - 1 - maxDrop; y--) {
      const b = read(cx, y, cz)
      if (b === undefined) return { ok: false, why: `cannot read ${cx},${y},${cz}`, cells: checked }
      if (!passable(b)) { surface = y; break }
    }
    if (surface === null) return { ok: false, why: `drop deeper than ${maxDrop} at ${cx},${hi},${cz}`, cells: checked }
    checked++
    // the body is wider than the line: lava beside the cell, anywhere in the band, refuses
    for (const sgn of [1, -1]) {
      const sx = Math.floor(feet.x + dx * i + side.x * sgn * BODY_HALF_WIDTH), sz = Math.floor(feet.z + dz * i + side.z * sgn * BODY_HALF_WIDTH)
      if (sx === cx && sz === cz) continue
      const b2 = lavaIn(sx, sz, hi + 2, lo - 1 - maxDrop)
      if (b2) return { ok: false, why: b2.replace('lava at', 'lava beside at').replace('cannot read', 'cannot read (beside)'), cells: checked }
    }
  }
  return { ok: true, why: `${checked} cell(s) clear`, cells: checked }
}

export const BLIND_STEP_HEADINGS = 4    // headings tried before standing still: the first safe one is walked

/**
 * Pick the first safe heading among `ang` and up to BLIND_STEP_HEADINGS-1 further
 * 60-degree turns in the same direction. Returns { ang, step } with step.ok, or
 * the last refusal with ok:false when none is safe -- standing still for one leg
 * beats walking off a ledge, and the next leg turns again anyway.
 */
export function pickBlindHeading (blockAt, pos, ang, turn, { headings = BLIND_STEP_HEADINGS } = {}) {
  let last = null
  for (let k = 0; k < headings; k++) {
    const a = ang + k * turn
    const step = blindStepIsSafe(blockAt, pos, a)
    if (step.ok) return { ang: a, step, tried: k + 1 }
    last = { ang: a, step, tried: k + 1 }
  }
  return last
}
