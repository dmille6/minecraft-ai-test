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
  let y = feet.y, checked = 0
  for (let i = 1; i <= blocks; i++) {
    const cx = Math.floor(feet.x + 0.5 + dx * i), cz = Math.floor(feet.z + 0.5 + dz * i)
    const f = read(cx, y, cz), h = read(cx, y + 1, cz)
    if (f === undefined || h === undefined) return { ok: false, why: `cannot read ${cx},${y},${cz}`, cells: checked }
    if (lava(f) || lava(h)) return { ok: false, why: `lava ahead at ${cx},${y},${cz}`, cells: checked }
    if (!passable(f)) {
      // solid at the feet: a one-high step is climbed, anything taller is a wall
      const above = read(cx, y + 2, cz)
      if (above === undefined) return { ok: false, why: `cannot read ${cx},${y + 2},${cz}`, cells: checked }
      if (lava(above)) return { ok: false, why: `lava ahead at ${cx},${y + 2},${cz}`, cells: checked }
      if (!passable(h) || !passable(above)) return { ok: true, why: `wall after ${checked} cell(s)`, cells: checked }
      y += 1; checked++
    } else if (!passable(h)) {
      return { ok: true, why: `wall after ${checked} cell(s)`, cells: checked }    // low ceiling: the body stops
    } else {
      // open cell: the landing must be within maxDrop, with no lava in the column
      let floor = null
      for (let d = 1; d <= maxDrop + 1; d++) {
        const b = read(cx, y - d, cz)
        if (b === undefined) return { ok: false, why: `cannot read ${cx},${y - d},${cz}`, cells: checked }
        if (lava(b)) return { ok: false, why: `lava below at ${cx},${y - d},${cz}`, cells: checked }
        if (!passable(b)) { floor = d; break }
      }
      // floor at y-1 is level ground (drop 0); at y-1-maxDrop it is a drop of maxDrop
      if (floor === null || floor - 1 > maxDrop) return { ok: false, why: `drop deeper than ${maxDrop} at ${cx},${y},${cz}`, cells: checked }
      y -= (floor - 1); checked++
    }
    // the body is wider than the line: lava beside the cell refuses
    for (const s of [1, -1]) {
      const sx = Math.floor(feet.x + 0.5 + dx * i + side.x * s * 0.7), sz = Math.floor(feet.z + 0.5 + dz * i + side.z * s * 0.7)
      if (sx === cx && sz === cz) continue
      for (const dy of [0, 1, -1]) {
        const b = read(sx, y + dy, sz)
        if (b === undefined) return { ok: false, why: `cannot read ${sx},${y + dy},${sz}`, cells: checked }
        if (lava(b)) return { ok: false, why: `lava beside at ${sx},${y + dy},${sz}`, cells: checked }
      }
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
