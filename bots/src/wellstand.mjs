// WELLFIX-01SHOW: THE THROWER IS CENTRED FOR THE AIM, NOT FOR THE STAND.
//
// LIVE (showcase 11-19 12:28Z .. 11-20, every hour): 0 of ~410 dispose_well visits threw; ~25 an hour were refused
// `off_stand` "1.20 from the well's centre (must be 0.8-1.15)", every one with the bot at 12.4,74,6.3 on the stand 12,74,6
// of the well 12,73,7 (facing north). The first one came 15 min after Bravo placed a crafting table at 13,74,6 (11-19
// 12:13:04Z, `_place_town`), the stand's east neighbour -- the cell every earlier arrival had come through (they rested
// at 12.6,6.5: 1.01 from the centre).
//
// THE REPLAY (scripts/wellstand-replay.mjs; the 11-18 region copy + that table): the real mineflayer-pathfinder 2.4.5 and
// prismarine-physics 1.11.1 bring the body in from the north and rest it at 12.440,6.305 from all five starts -- the
// executor's `fullStop` keeps any rest within 0.2 of the cell's centre (index.js: it snaps only past 0.2), so a walk in
// along the throw's own axis ends up to 0.2 short. Without the table it rests at 12.637,6.498 (1.011).
//
// THE DEFECT that the table exposed is in dispose_well, not in the world: "on the stand" is centredOn's 0.3 a side
// (STAND_CENTRE_TOL), so the nudge never ran for 6.305 (0.195 off), while the aim's window along its axis is only
// -0.2 .. +0.15 of the stand's centre (MIN_TOSS_DIST 0.8 .. MAX_TOSS_DIST 1.15). Two correct tests that do not compose.
// The window is not widened (it is the simulation's 98.2% hit line, sandbox 1 miss in 12 at 1.15); the bot is moved into it.
import { MIN_TOSS_DIST, MAX_TOSS_DIST } from './well.mjs'

/** The nudge stops within this of the stand's centre on each axis (0.08: 0.88..1.12 along the axis, both inside the window). */
export const AIM_CENTRE_TOL = 0.08
/** The nudge's bound in ticks (2 s). At sneak speed (~0.03-0.065 a tick) 0.2 takes 4-8 ticks. */
export const AIM_CENTRE_TICKS = 40

/**
 * IS THIS BODY INSIDE THE AIM'S WINDOW? -> { ok, dist, target, off, why }. Pure. `from` the feet, `cap` the well's cap cell,
 * `stand` the cell the bot stands in. `target` is that cell's centre (the nudge's goal when not ok).
 */
export function standCentreFor ({ from, cap, stand }) {
  const dist = Math.hypot(cap.x + 0.5 - from.x, cap.z + 0.5 - from.z)
  const ok = dist >= MIN_TOSS_DIST - 1e-9 && dist <= MAX_TOSS_DIST + 1e-9
  const target = { x: stand.x + 0.5, z: stand.z + 0.5 }
  return { ok, dist, target, off: Math.hypot(target.x - from.x, target.z - from.z), why: ok ? null : `${dist.toFixed(2)} from the well's centre (must be ${MIN_TOSS_DIST}-${MAX_TOSS_DIST})` }
}

/**
 * THE NUDGE INTO THE WINDOW -> { ticks, pos }. Sneak-walks toward `target` ({x, z}), re-aiming every tick, and stops within
 * `tol` on both axes or after `maxTicks`. Sneaking because it is slow (no overshoot past a 0.08 box) and because a sneaking
 * body never walks off an edge -- the open well is the next cell. On exit the controls are released and the horizontal
 * velocity zeroed, exactly as mineflayer-pathfinder's own fullStop does at every arrival (index.js). `tick` waits one
 * physics tick (dispose_well passes its bounded waitForTicks).
 */
export async function nudgeToCentre (bot, target, { tick, signal = null, tol = AIM_CENTRE_TOL, maxTicks = AIM_CENTRE_TICKS } = {}) {
  let t = 0
  try {
    for (; t < maxTicks; t++) {
      if (signal?.aborted) break
      const p = bot.entity.position
      const dx = target.x - p.x, dz = target.z - p.z
      if (Math.abs(dx) <= tol && Math.abs(dz) <= tol) break
      await bot.look(Math.atan2(-dx, -dz), bot.entity.pitch ?? 0, true)
      bot.setControlState('sneak', true)
      bot.setControlState('forward', true)
      await tick()
    }
  } finally {
    try { bot.setControlState('forward', false) } catch { /* nothing held */ }
    try { bot.setControlState('sneak', false) } catch { /* nothing held */ }
    try { if (bot.entity?.velocity) { bot.entity.velocity.x = 0; bot.entity.velocity.z = 0 } } catch { /* read-only double */ }
  }
  return { ticks: t, pos: bot.entity.position }
}
