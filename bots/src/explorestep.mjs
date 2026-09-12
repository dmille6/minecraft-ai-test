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

const passable = b => !b || b.name === 'air' || b.boundingBox === 'empty' ||
  b.name === 'water' || b.name === 'cave_air' || b.name === 'void_air'
const lava = b => !!b && /lava/.test(b.name || '')

/**
 * @param {(x:number,y:number,z:number)=>object|null} blockAt  world read
 * @param {{x:number,y:number,z:number}} feet   the bot's feet cell (floored)
 * @param {number} yaw   mineflayer yaw (radians); forward = (-sin yaw, -cos yaw)
 * @returns {{ok:boolean, why:string, cells:number}}
 */
export function blindStepIsSafe (blockAt, feet, yaw, { blocks = BLIND_STEP_BLOCKS, maxDrop = BLIND_STEP_MAX_DROP } = {}) {
  const dx = -Math.sin(yaw), dz = -Math.cos(yaw)
  const side = { x: -dz, z: dx }                 // perpendicular, for the body's width
  const read = (x, y, z) => { try { return blockAt(x, y, z) } catch { return undefined } }
  // THE REFERENCE HEIGHT ONLY EVER RISES. Going UP, the body must land on each
  // step before it can jump the next, so a one-high step raises the reference
  // (Codex, fourth pass: two steps up put the original head cell under the
  // feet). Going DOWN, forward+jump can carry the body over a descending ledge
  // without landing (Codex, second pass), so a drop never lowers the reference
  // and a chain of small drops is judged as one fall from the highest ground
  // reached. Every cell is judged against the band [base-1-maxDrop, base+2]:
  // the jump arc above, the deepest tolerated landing below.
  let base = feet.y, checked = 0
  const lavaIn = (x, z, top, bot) => {
    for (let y = top; y >= bot; y--) {
      const b = read(x, y, z)
      if (b === undefined) return `cannot read ${x},${y},${z}`
      if (lava(b)) return `lava at ${x},${y},${z}`
    }
    return null
  }
  for (let i = 1; i <= blocks; i++) {
    const cx = Math.floor(feet.x + 0.5 + dx * i), cz = Math.floor(feet.z + 0.5 + dz * i)
    const yTop = base + 2, yBot = base - 1 - maxDrop
    const bad = lavaIn(cx, cz, yTop, yBot)
    if (bad) return { ok: false, why: bad, cells: checked }
    // only a solid HEAD cell (base+1) is a wall; a solid at base+2 is a low
    // ceiling the 1.8-tall body walks under (Codex, third pass)
    const head = read(cx, base + 1, cz)
    if (head === undefined) return { ok: false, why: `cannot read ${cx},${base + 1},${cz}`, cells: checked }
    if (!passable(head)) return { ok: true, why: `wall after ${checked} cell(s)`, cells: checked }
    // the standing surface: the highest solid at or below base (solid AT base is
    // a one-high step: climbable when the two cells above it are clear)
    let surface = null
    for (let y = base; y >= yBot; y--) {
      const b = read(cx, y, cz)
      if (b === undefined) return { ok: false, why: `cannot read ${cx},${y},${cz}`, cells: checked }
      if (!passable(b)) { surface = y; break }
    }
    if (surface === null) return { ok: false, why: `drop deeper than ${maxDrop} at ${cx},${base},${cz}`, cells: checked }
    if (surface === base) {
      const above = read(cx, base + 2, cz)
      if (above === undefined) return { ok: false, why: `cannot read ${cx},${base + 2},${cz}`, cells: checked }
      if (!passable(above)) return { ok: true, why: `wall after ${checked} cell(s)`, cells: checked }   // a step with no headroom
      base += 1                                                     // landed on the step: the reference rises
    }
    checked++
    // the body is wider than the line: lava beside the cell, anywhere in the band, refuses
    for (const sgn of [1, -1]) {
      const sx = Math.floor(feet.x + 0.5 + dx * i + side.x * sgn * 0.7), sz = Math.floor(feet.z + 0.5 + dz * i + side.z * sgn * 0.7)
      if (sx === cx && sz === cz) continue
      const b2 = lavaIn(sx, sz, base + 2, base - 1 - maxDrop)
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
export function pickBlindHeading (blockAt, feet, ang, turn, { headings = BLIND_STEP_HEADINGS } = {}) {
  let last = null
  for (let k = 0; k < headings; k++) {
    const a = ang + k * turn
    const step = blindStepIsSafe(blockAt, feet, a)
    if (step.ok) return { ang: a, step, tried: k + 1 }
    last = { ang: a, step, tried: k + 1 }
  }
  return last
}
