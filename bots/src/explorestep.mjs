// explorestep.mjs -- is a short BLIND walk in a heading safe to take?
//
// explore's leg loop walks forward+jump for 1.2 s after a failed leg, to prove
// to the reflex layer that the bot is not stuck and to start the next plan from
// somewhere else. The pathfinder is not consulted for that walk, so nothing
// prices the ground ahead. Overnight 2026-09-11/12: 13 of 28 fleet deaths
// involved a fall, nearly all during or right after explore; board-a-Echo fell
// 26 blocks at 05:42 after six path timeouts, exactly this branch.
//
// Pure over a blockAt function so the test can hand it a map. Reads at most
// `blocks` cells along the heading: a wall ends the probe (walking into a wall
// is harmless); a missing floor deeper than `maxDrop` or lava anywhere in the
// column refuses. Water is terrain (owner directive) and is NOT refused here.
export const BLIND_STEP_BLOCKS = 4      // ~1.2 s of forward+jump covers about this
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
  let checked = 0
  for (let i = 1; i <= blocks; i++) {
    const cx = Math.floor(feet.x + 0.5 + dx * i), cz = Math.floor(feet.z + 0.5 + dz * i)
    let f, h
    try { f = blockAt(cx, feet.y, cz); h = blockAt(cx, feet.y + 1, cz) } catch { return { ok: false, why: `cannot read ${cx},${feet.y},${cz}`, cells: checked } }
    if (lava(f) || lava(h)) return { ok: false, why: `lava ahead at ${cx},${feet.y},${cz}`, cells: checked }
    if (!passable(f) || !passable(h)) return { ok: true, why: `wall after ${checked} cell(s)`, cells: checked }   // stops the walk
    // the floor: first solid within maxDrop below the feet
    let floor = null
    for (let d = 1; d <= maxDrop + 1; d++) {
      let b
      try { b = blockAt(cx, feet.y - d, cz) } catch { return { ok: false, why: `cannot read ${cx},${feet.y - d},${cz}`, cells: checked } }
      if (lava(b)) return { ok: false, why: `lava below at ${cx},${feet.y - d},${cz}`, cells: checked }
      if (!passable(b)) { floor = d; break }
    }
    // floor at feet.y-1 is level ground (drop 0); at feet.y-1-maxDrop it is a drop of maxDrop
    if (floor === null || floor - 1 > maxDrop) return { ok: false, why: `drop deeper than ${maxDrop} at ${cx},${feet.y},${cz}`, cells: checked }
    checked++
  }
  return { ok: true, why: `${checked} cell(s) clear`, cells: checked }
}
