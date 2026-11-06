// ESCDEAD-01: BREAK THE ESCAPE DEAD ENDS (phase 2.3 of the 11-06 code evaluation; docs/reports/escdead-design-2026-11-06.md).
//
// MEASURED (fleet, 80 bots, 7 d to 11-06 11:00Z, 13,409 online bot-h): 124 pins of 1 h or more = 457.1 bot-h (3.4%); the
// climb-flood refusal chain is in 34 of them = 335.7 bot-h (73% of pinned time). isolated-d-Delta 103.8 h and -Echo 101.8 h
// in ONE cell (358,58,180, ongoing), hive-c-Bravo 16.1 h (ongoing). Every rung refuses, each correctly: the flood guard
// ("liquid above the block overhead"), plugcut ("the wet face 0,3,0 is a cell the climb needs open"), the pathfinder
// ("sealed_in_liquid"), and swimunder-01 ("no way out within 4 cells") -- and the refusal names "goto away", the pathfinder
// that just refused. Two correct guards composed into a dead end; nothing acts on the pin.
//
// THIS FILE, all pure except the actuator:
//   - the PIN CLOCK: how long the body has stayed in one 3-block box (the episode the two moves below are gated on);
//   - the WIDE SWIM: on a pin of 30 min or more, swimunder's search grows (radius 4 -> 8, descent 2 -> 4). The 11-06 backup cut
//     of 358,58,180 has no exit at radius 4 (the bots placed stone at the old way out, 357,58,180) and a 10-cell dry exit at
//     radius 8 / descent 4 with a head-under-water run of 4 (swimunder's own breath bound, SU_MAX_WET_RUN 5, is unchanged);
//   - the FLOOD-IN BREACH: on a pin of 30 min or more, with the head in air, full air and health >= 18, no lava near, and the
//     water over the roof OPEN TO AIR within BREACH_MAX_WATER cells: break the roof, let the water in, swim straight up. Water
//     is terrain (owner). The 11-06 cut of hive-c-Bravo's pocket: roof dirt at y54, 8 water sources y55..62, open air at y63.
//     A roof whose water is closed above (358,58,180: granite, ONE water cell, then dirt) is refused -- breaching it floods
//     the pocket and opens nothing, the trade the flood guard exists to stop;
//   - ESCDEAD=0 turns all of it off (and the pinned-escape pickaxe rule in toolfor.mjs, and the terrain depth in
//     protectzone.mjs): every call site then runs the base line unchanged.
import { Vec3 } from 'vec3'
import { isWaterCell, isLavaCell } from './scaffold.mjs'
import { swimFits, swimUnderStep, airEstimate } from './swimunder.mjs'
import { escDeadOn } from './toolfor.mjs'

/** ESCDEAD=0|off|false|no turns escdead-01 off (the one-setting rollback); anything else, or unset, leaves it on. Pure.
 *  Defined in toolfor.mjs (which imports nothing) so the pickaxe rule and this file read one switch. */
export { escDeadOn }

/** A pin is this long in one box before the wide swim and the breach are allowed. ESCDEAD_PIN_MS overrides it (the Paper
 *  scene runs 9 min: the sandbox proof sets it low and says so in its rows; the fleet never sets it). */
export const PIN_MIN_MS = 30 * 60_000
export const pinMinMs = (env = typeof process !== 'undefined' ? process.env : {}) => {
  const v = Number(env?.ESCDEAD_PIN_MS)
  return Number.isFinite(v) && v >= 10_000 ? v : PIN_MIN_MS
}
/** The box (Chebyshev, every axis, from the episode's first cell) a pinned body stays inside. failmine's still box. */
export const PIN_BOX = 3

/** THE PIN CLOCK -> { anchor: [x,y,z], since }. Pure. A body that leaves the box (or has no position) starts a new episode. */
export function pinStep (prev, pos, now) {
  if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y) || !Number.isFinite(pos.z)) return null
  const c = [pos.x, pos.y, pos.z]
  if (!prev || !Array.isArray(prev.anchor)) return { anchor: c, since: now }
  const out = Math.max(Math.abs(c[0] - prev.anchor[0]), Math.abs(c[1] - prev.anchor[1]), Math.abs(c[2] - prev.anchor[2])) > PIN_BOX
  return out ? { anchor: c, since: now } : prev
}
/** How long the clock has run -> ms (0 when there is none). Pure. */
export const pinnedFor = (st, now) => (st && Number.isFinite(st.since) ? Math.max(0, now - st.since) : 0)

/** THE WIDE SEARCH swimunder runs on a long pin: geometry only (Codex design: widen the box, never the breath -- the route
 *  length, the ascent and SU_MAX_WET_RUN stay the base's). The 11-06 cut's exit is 10 cells, wet run 4. */
export const SU_WIDE = Object.freeze({ radius: 8, maxDown: 4 })
/** swimUnderPlan's options for this pin -> {} (the base search) | SU_WIDE. Pure. */
export function swimSearchFor (pinnedMs, { on = escDeadOn(), minMs = pinMinMs() } = {}) {
  return on && pinnedMs >= minMs ? SU_WIDE : {}
}

// ---- the flood-in breach ---------------------------------------------------------------------------------------------
/** The deepest water over the roof a breach swims up through: 8 cells is a 10-cell rise, exactly the breath budget below
 *  (240 ticks); the prismarine sim of hive-c's 8 took 73-97 ticks. */
export const BREACH_MAX_WATER = 8
export const BREACH_MIN_HEALTH = 18
export const BREACH_MIN_OXYGEN = 20          // full (oxygen.mjs AIR_SCALE 0..20)
export const BREACH_LAVA_R = 4               // no lava within this many cells (Chebyshev) of the pocket or the column
export const BREACH_DIG_MS = 12_000          // the roof dig, at most (the head is in air while it runs)
export const BREACH_STALL_MS = 4_000         // no height gained for this long: counted in the row (the rise goes on to the budget)
export const BREACH_BUDGET_MS = 25_000       // one firing, dig and rise
export const BREACH_BACKOFF_MS = [30, 60].map(m => m * 60_000)
/** THE BREATH BUDGET (Codex design, server ticks): launch 20, each falling-water cell 30 (the cells the breach floods: the head
 *  cell and the old roof -- a 1x1 falling column pushes the body down, prismarine-physics getFlow), each still-water cell 20;
 *  60 of the 300 ticks of air kept unused -> at most 240. The prismarine sim of hive-c's 10-cell rise took 73 ticks. */
export const BREACH_TICKS = Object.freeze({ launch: 20, falling: 30, still: 20, reserve: 60, air: 300 })
export const breachTicks = route => BREACH_TICKS.launch + (route?.length ?? 0) * BREACH_TICKS.still +
  Math.min(2, route?.length ?? 0) * (BREACH_TICKS.falling - BREACH_TICKS.still)
const UNBREAKABLE = /^(bedrock|barrier|obsidian|crying_obsidian|reinforced_deepslate|end_portal_frame|end_portal|nether_portal|.*command_block|structure_block|jigsaw|light|respawn_anchor|spawner|trial_spawner|vault)$/
const solid = b => !!b && b.boundingBox === 'block'
const k3 = c => c.join(',')

/**
 * THE BREACH -> { ok, roof, water, top, route, reason }. Pure.
 *   at(x,y,z)  block at ABSOLUTE coordinates (null = unloaded: never a plan)
 *   feet       the feet cell [x,y,z]
 * The pocket: the head cell (feet+1) holds air; the roof (feet+2) is a solid, breakable block; over the roof, `water` cells
 * of water (1..BREACH_MAX_WATER) the body fits through, then TWO cells of air: an open surface (swimunder exitKind 'open':
 * feet in the top water cell, head and the cell over it in air). No lava within BREACH_LAVA_R of the pocket or the column.
 * `route` = the feet cells the rise passes, feet+1 .. top (top = the last water cell: feet in water, head in the air).
 */
export function breachPlan ({ at = () => null, feet, maxWater = BREACH_MAX_WATER } = {}) {
  const no = reason => ({ ok: false, roof: null, water: 0, top: null, route: [], reason })
  if (!Array.isArray(feet) || feet.length !== 3) return no('no feet cell')
  const [x, y, z] = feet
  const f = at(x, y, z), h = at(x, y + 1, z), r = at(x, y + 2, z)
  if (!f || !h || !r) return no('terrain not loaded at the pocket')
  if (!swimFits(f) || !swimFits(h)) return no('the body does not fit its own cells')
  if (isWaterCell(h)) return no('the head is under water: breathe first, the drowning rescue owns this')
  if (!solid(r)) return no(`the roof is not a block (${r.name})`)
  if (UNBREAKABLE.test(r.name ?? '')) return no(`the roof is ${r.name}: no escape breaks it`)
  let water = 0, yy = y + 3
  for (; yy <= y + 3 + maxWater; yy++) {
    const b = at(x, yy, z)
    if (!b) return no(`terrain not loaded over the roof (y=${yy})`)
    if (isLavaCell(b)) return no(`lava over the roof (y=${yy})`)
    if (isWaterCell(b) && swimFits(b)) { water++; continue }
    break
  }
  if (water === 0) return no('no water over the roof: not a flood refusal this breach answers')
  const top1 = at(x, yy, z), top2 = at(x, yy + 1, z)
  if (water > maxWater || yy > y + 2 + maxWater + 1) return no(`more than ${maxWater} cells of water over the roof: too deep to swim up on one breath`)
  if (!top1 || !top2) return no(`terrain not loaded at the surface (y=${yy})`)
  if (!(swimFits(top1) && !isWaterCell(top1) && swimFits(top2) && !isWaterCell(top2))) {
    return no(`the water over the roof is closed by ${top1.name} at y=${yy}: a breach would flood the pocket and open nothing`)
  }
  // NO LAVA NEAR THE POCKET OR THE COLUMN (the breach adds a falling water column; water on lava is obsidian or stone, and a
  // flow can also open a lava face beside the bot)
  for (let cy = y - 1; cy <= yy + 1; cy++) {
    for (let dx = -BREACH_LAVA_R; dx <= BREACH_LAVA_R; dx++) {
      for (let dz = -BREACH_LAVA_R; dz <= BREACH_LAVA_R; dz++) {
        if (isLavaCell(at(x + dx, cy, z + dz))) return no(`lava within ${BREACH_LAVA_R} cells (${x + dx},${cy},${z + dz})`)
      }
    }
  }
  const top = [x, yy - 1, z]
  const route = []
  for (let cy = y + 1; cy <= top[1]; cy++) route.push([x, cy, z])
  const ticks = breachTicks(route)
  if (ticks > BREACH_TICKS.air - BREACH_TICKS.reserve) return no(`the rise is ${ticks} ticks of breath, over ${BREACH_TICKS.air - BREACH_TICKS.reserve}`)
  return { ok: true, roof: [x, y + 2, z], water, top, route, ticks, reason: null }
}

/**
 * MAY A BREACH FIRE -> { ok, why }. Pure. The owner's rule: pinned 30 min or more at this place, the head in air, full air,
 * health 18 or more, no lava (the plan's), and the escape that runs it on (ESCDEAD). Air unreported with the head in air is
 * full air (swimunder's Paper finding 11-03: mineflayer only learns air when it CHANGES).
 */
export function breachAdmit ({ plan, pinnedMs = 0, oxygen = null, health = 0, headAir = false, others = 0, on = escDeadOn(), minMs = pinMinMs() } = {}) {
  if (!on) return { ok: false, why: 'ESCDEAD=0' }
  if (!plan?.ok) return { ok: false, why: plan?.reason ?? 'no plan' }
  // ANOTHER BODY IN THE POCKET (Codex design): the breach floods its air too, and two bodies rising one 1x1 column collide.
  // Not admitted; the other bot's own escape (or its swim) runs first.
  if (others > 0) return { ok: false, why: `${others} other bot(s) share the pocket: a breach floods their air too` }
  if (!(pinnedMs >= minMs)) return { ok: false, why: `pinned ${Math.round(pinnedMs / 60_000)} min, below ${Math.round(minMs / 60_000)}` }
  if (headAir !== true) return { ok: false, why: 'the head is not in air' }
  if (Number.isFinite(oxygen) && oxygen < BREACH_MIN_OXYGEN) return { ok: false, why: `air ${oxygen} of 20: breathe first` }
  if (!(health >= BREACH_MIN_HEALTH)) return { ok: false, why: `health ${health}, below ${BREACH_MIN_HEALTH}` }
  return { ok: true, why: null }
}

/** The per-place back-off after a breach that did not get out: 30, then 60 min. Pure. */
export const breachBackoffMs = tries => BREACH_BACKOFF_MS[Math.min(Math.max(1, tries), BREACH_BACKOFF_MS.length) - 1]

/** IS THE BODY OUT at the surface -> boolean. Pure: the eye is in air and the feet are at or above the top cell. */
export function breachOut ({ pos, top, eyeWet }) {
  return !!pos && !!top && eyeWet === false && pos.y >= top[1] - 0.2
}

/** The `_escdead_mode` licence row, once per spawn (features.mjs). Pure. */
export function escDeadModeDetail (env = typeof process !== 'undefined' ? process.env : {}) {
  return `on=${escDeadOn(env) ? 1 : 0} pin_min=${Math.round(pinMinMs(env) / 60_000)} wide=r${SU_WIDE.radius}/d${SU_WIDE.maxDown} ` +
         `breach_water<=${BREACH_MAX_WATER} hp>=${BREACH_MIN_HEALTH} pinned_last_swing=1 zone_depth=terrain`
}

/** The `_flood_breach` row's detail. Pure. */
export function breachRowDetail (r = {}) {
  return `outcome=${r.outcome} roof=${r.roof ?? '-'} water=${r.water ?? 0} top=${r.top ?? '-'} rose=${(r.rose ?? 0).toFixed(1)} ` +
         `dig_ms=${r.digMs ?? 0} min_air=${r.minAir ?? '-'} hp=${r.hp0 ?? '-'}->${r.hp1 ?? '-'} ms=${r.ms ?? 0}${r.why ? ` -- ${r.why}` : ''}`
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const nextTick = bot => new Promise(resolve => {
  let done = false
  const fin = () => { if (done) return; done = true; clearTimeout(t); try { bot.removeListener?.('physicsTick', fin) } catch {} ; resolve() }
  const t = setTimeout(fin, 100)
  try { bot.once('physicsTick', fin) } catch { fin() }
})

/**
 * THE ACTUATOR -> { outcome: 'out'|'failed'|'yielded', ... }. Breaks the roof with `dig(block)` (the caller's: the escape's
 * tool policy, the escape guard and a bounded dig), then rises straight up the column with swimunder's own vertical
 * controller (centre in the column, then jump held), until the eye is in air at the surface. There is NO turning back: the
 * pocket floods once the roof is open, so a stall stops steering and leaves the body to the drowning rescue (the backstop
 * every swim relies on). Every exit clears the controls it set, except after a yield (the new owner's body).
 *   alive()    -> false when another owner took the body      yieldTo() -> reason | null (the drowning rescue, a danger move)
 *   oxygen()   -> the guarded air reading (0..20 or null)      now()     -> ms
 */
export async function floodBreach (bot, { plan, dig, alive = () => true, yieldTo = () => null, oxygen = () => bot.oxygenLevel,
  renew = () => {}, now = Date.now } = {}) {
  const t0 = now()
  const res = { outcome: 'failed', roof: k3(plan.roof), water: plan.water, top: k3(plan.top), rose: 0, digMs: 0,
                minAir: oxygen() ?? null, hp0: bot.health, hp1: bot.health, ms: 0, why: null }
  const at = (x, y, z) => { try { return bot.blockAt?.(new Vec3(x, y, z)) ?? null } catch { return null } }
  const set = (k, v) => { try { bot.setControlState(k, v) } catch {} }
  const clear = () => { set('forward', false); set('jump', false); set('sprint', false); set('sneak', false) }
  const look = (x, z) => { try { bot.lookAt(new Vec3(x, bot.entity.position.y + 1.62, z), true) } catch {} }
  const eyeWet = () => { try { const p = bot.entity.position; return isWaterCell(at(Math.floor(p.x), Math.floor(p.y + 1.62), Math.floor(p.z))) } catch { return true } }
  let yielded = false, holdUp = false
  try {
    // OWNERSHIP FIRST (Codex r1 BLOCKER 1): a body the rescue (or anything) took while this firing waited is never touched --
    // no control cleared, nothing dug; and once more right before the dig, after the re-reads
    const lost = () => { if (!alive()) return 'ownership lost'; const y = yieldTo(); return y ? `yielded: ${y}` : null }
    const l0 = lost()
    if (l0) { res.outcome = 'yielded'; yielded = true; res.why = `${l0} before the dig`; return res }
    clear()
    // THE ROOF, RE-READ: the plan is only as good as the world now
    const roof = at(...plan.roof)
    if (!solid(roof)) { res.why = `the roof is no longer a block (${roof?.name ?? 'unloaded'})`; return res }
    const above = at(plan.roof[0], plan.roof[1] + 1, plan.roof[2])
    if (!isWaterCell(above)) { res.why = `the cell over the roof is no longer water (${above?.name ?? 'unloaded'})`; return res }
    const l1 = lost()
    if (l1) { res.outcome = 'yielded'; yielded = true; res.why = `${l1} before the dig`; return res }
    const d0 = now()
    const dug = await dig(roof).then(() => null, e => e?.message ?? String(e))
    res.digMs = now() - d0
    // THE WORLD FIRST (Claude r1 note 1): a dig that rejected AFTER the block broke (a timeout racing the break) has still
    // opened the roof -- the pocket floods either way, so whether to rise is the roof's state, never the promise's
    const after = at(...plan.roof)
    if (solid(after)) {
      if (!alive()) { res.outcome = 'yielded'; yielded = true; res.why = 'ownership lost during the dig'; return res }
      res.why = dug ? `the roof dig failed: ${dug}` : `the roof is still ${after.name} after the dig`
      return res
    }
    if (dug) res.digError = dug
    // THE RISE: swimunder's vertical controller, one cell at a time, from the feet cell to the top water cell
    let est = Number.isFinite(oxygen()) ? oxygen() : 20
    const y0 = bot.entity.position.y
    let best = y0, tBest = now()
    let from = (p => [Math.floor(p.x), Math.floor(p.y + 1e-6), Math.floor(p.z)])(bot.entity.position)
    for (let i = 0; i < plan.route.length; i++) {
      const to = plan.route[i]
      for (;;) {
        if (!alive()) { res.outcome = 'yielded'; yielded = true; res.why = 'ownership lost'; return res }
        const y = yieldTo()
        if (y) { res.outcome = 'yielded'; yielded = true; res.why = `yielded: ${y}`; return res }
        const rep = oxygen()
        const air = Number.isFinite(rep) ? rep : Math.floor(est)
        res.minAir = Math.min(Number.isFinite(res.minAir) ? res.minAir : 20, air)
        const p = bot.entity.position
        res.rose = Math.max(res.rose, p.y - y0)
        const wet = eyeWet()
        if (breachOut({ pos: p, top: plan.top, eyeWet: wet })) { res.outcome = 'out'; return res }
        if (p.y > best + 0.05) { best = p.y; tBest = now() }
        // A STALL IS NOT A STOP (Codex design: never clear the controls under water). The pocket behind is flooded, so the
        // only air is up: keep rising; the stall is counted, and only the budget (or a yield to the rescue) ends the firing,
        // with jump still held (holdUp) so the body is not dropped back into the column.
        if (now() - tBest > BREACH_STALL_MS) { res.stalls = (res.stalls ?? 0) + 1; tBest = now() }
        if (now() - t0 > BREACH_BUDGET_MS) { res.why = `over the ${BREACH_BUDGET_MS / 1000} s budget at y=${p.y.toFixed(2)} (stalls ${res.stalls ?? 0})`; holdUp = true; return res }
        const st = swimUnderStep({ pos: p, vel: bot.entity.velocity ?? {}, from, to })
        if (st.arrived) break
        if (st.look) look(st.look.x, st.look.z)
        set('forward', !!st.forward); set('jump', !!st.jump)
        await nextTick(bot)
        est = airEstimate(est, eyeWet())
      }
      from = to
      renew()
    }
    // THE LAST CELL REACHED: hold the head up until the eye is out (the float hold takes over once the firing ends)
    for (let n = 0; n < 40; n++) {
      const p = bot.entity.position
      res.rose = Math.max(res.rose, p.y - y0)
      if (breachOut({ pos: p, top: plan.top, eyeWet: eyeWet() })) { res.outcome = 'out'; return res }
      if (!alive() || yieldTo()) { res.outcome = 'yielded'; yielded = true; res.why = 'yielded at the surface'; return res }
      set('jump', true)
      await nextTick(bot)
    }
    res.why = `the column was climbed but the eye is still under water at y=${bot.entity.position.y.toFixed(2)}`
    holdUp = true
    return res
  } finally {
    // after the roof is open the body is never dropped: a failed rise keeps jump held for the float hold / rescue to take over
    if (!yielded) { if (holdUp) { set('forward', false); set('sprint', false); set('sneak', false); set('jump', true) } else clear() }
    res.hp1 = bot.health
    res.ms = now() - t0
    await sleep(0)
  }
}
