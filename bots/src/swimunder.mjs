// SWIMUNDER-01: A BOT PINNED IN A WET-CEILING POCKET SWIMS OUT THE WAY IT CAME IN (docs/reports/dropdig-design-2026-11-03.md).
//
// THE TRAP (72 h to 2026-11-03T21:00Z, 80 of 80 bots, 5,760 positioned bot-h): 23 still spells (>= 30 min) carried the
// climb-flood refusal chain, 120.2 bot-h = 40% of all still time, on 21 bots; isolated-d-Delta and isolated-d-Echo were
// pinned 41.7 h and 38.0 h in ONE cell (358,58,180) and still were. The bot floats with its feet in a body of water and
// its head in a one-cell air pocket: the roof (feet+2) is solid with WATER on top of it (feet+3), every head-level wall
// touches water. Every rung refuses, each correctly:
//   - the pathfinder: "sealed_in_liquid visited=1 startLiquid=true" (no successor from a sealed liquid start; upstream
//     mineflayer-pathfinder #117 WONTFIX);
//   - the pillar / ramp breach / shaft ascent: `_climb_flood_guard` "liquid above the block overhead" (climbflood-01: the
//     bot's own escape dig was the largest single way into a drowning);
//   - plugcut-01: "the wet face 0,3,0 is a cell the climb needs open" (~1,000 refusals on ~25 bots in 3 days, 6 plugs);
//   - the refusal row names "leave this cell sideways or downward (mine or goto away from the water)" -- and goto is the
//     pathfinder that just refused. Two correct guards composed into a dead end.
// The bots got IN through the water (isolated-d-Echo: a fall into the lake, `_water_float` up into the pocket). The way
// out is the way in: sink under the head-level wall, swim a few cells, come up where the head is in open air. Water is
// terrain; swimming is travel.
//
// THIS FILE: the plan (a bounded search over the cells a 0.6 x 1.8 body fits through), the admission (air and health),
// the per-tick controller and the abort rule, all pure; and the actuator, which steers one body along a plan and turns
// back along its own wake to the last cell where the head was in air when anything goes wrong. It never digs and never
// places. It is a travel move used by the escape arms after the flood refusal; it is not a water reflex.
import { Vec3 } from 'vec3'
import { bodyPassable, isWaterCell, isLavaCell } from './scaffold.mjs'

/** SWIMUNDER=0 turns the move off (the one-setting rollback); anything else, or unset, leaves it on. */
export const swimUnderOn = (env = typeof process !== 'undefined' ? process.env : {}) =>
  !/^(0|off|false|no)$/i.test(String(env?.SWIMUNDER ?? '1').trim())

export const SU_RADIUS = 4            // Chebyshev, horizontal, from the start column (Codex design: radius 4)
export const SU_MAX_DOWN = 2          // the deepest the feet go below the start (Codex design: descent <= 2)
export const SU_MAX_UP = 6            // the highest the feet go above the start
export const SU_MAX_WET_RUN = 5       // the longest stretch of consecutive cells with the head in water (~2.5-4 s at ~2 b/s)
export const SU_MAX_LEN = 14          // cells in a plan
export const SU_MIN_OXYGEN = 19       // admission: air (0..20 scale, oxygen.mjs AIR_SCALE) all but full
export const SU_MIN_HEALTH = 14       // admission
export const SU_ABORT_OXYGEN = 10     // turn back at or below this much air (half the bar: >= 7 s of breath left)
export const SU_STEP_MS = 3000        // one cell, at most (a water cell is ~0.5 s at ~2 b/s; corners and the bob cost more)
export const SU_BUDGET_MS = 25_000    // one firing, out and back
export const SU_BACKOFF_MS = [5, 10, 20, 40, 60].map(m => m * 60_000)
export const SU_NOPLAN_BACKOFF_MS = [1, 5, 10, 20, 40, 60].map(m => m * 60_000)   // the first no-plan answer may be a transient
export const SU_CENTRE_TOL = 0.2      // the 0.6 body is inside a 1.0 column when its centre is within 0.2 of the column centre
export const SU_BAND = 0.25           // feet height within [cell y, cell y + band] before a sideways stroke (head stays under y+2)
export const SU_COAST = 4             // water inertia 0.8: a body carries ~4 ticks of its speed after forward is released

const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]]
const key = c => c.join(',')
const solid = b => !!b && b.boundingBox === 'block'
const HURTS = /^(magma_block|campfire|soul_campfire|fire|soul_fire|sweet_berry_bush|cactus|pointed_dripstone|wither_rose|powder_snow)$/

/**
 * A cell the body may occupy while swimming: nothing with a collision box, no lava, no cobweb (bodyPassable), and not a
 * bubble column (it pushes the body up or drags it down -- never a waypoint), powder snow, or anything that hurts.
 * An unloaded cell (null) is never clear.
 */
export function swimFits (b) {
  if (!bodyPassable(b)) return false
  if (b.name === 'bubble_column') return false
  return !HURTS.test(b.name ?? '')
}
/** Water the head can be in: water in any form, waterlogged too (scaffold.mjs isWaterCell). */
export const headWet = b => isWaterCell(b)
/** Water the FEET swim in (a node of the search). A waterlogged block with no collision box counts; kelp, seagrass too. */
const feetWet = b => isWaterCell(b) && swimFits(b)

/**
 * IS THIS CELL AN EXIT, and of which kind -> 'dry' | 'open' | null. Pure.
 *   dry   the feet and head cells hold air (no water), the cell under the feet is solid and does not hurt: the bot stands
 *         on dry ground, from which the land pathfinder plans (the trap's `startLiquid` is gone).
 *   open  the feet are in water, the head in air, and the two cells above the head are air too: an open surface, not
 *         under a roof (the start pocket is never one: its roof is at feet+2).
 */
export function exitKind (at, [x, y, z]) {
  const f = at(x, y, z), h = at(x, y + 1, z)
  if (!swimFits(f) || !swimFits(h) || headWet(h)) return null
  if (!isWaterCell(f)) {
    const fl = at(x, y - 1, z)
    return solid(fl) && !HURTS.test(fl.name ?? '') ? 'dry' : null
  }
  const a = at(x, y + 2, z), a2 = at(x, y + 3, z)
  return swimFits(a) && !headWet(a) && swimFits(a2) && !headWet(a2) ? 'open' : null
}

/** Lava on any face of the body's two cells at `c` (the search never routes the body beside lava). */
function lavaBeside (at, [x, y, z]) {
  for (const dy of [0, 1]) for (const [dx, ey, dz] of DIRS) if (isLavaCell(at(x + dx, y + dy + ey, z + dz))) return true
  return false
}

/**
 * THE WAY OUT -> { ok, route: [[x,y,z],...] (feet cells, the start excluded), exit, wet, wetRun, reason }. Pure.
 *   at(x,y,z)  block at ABSOLUTE coordinates (null = unloaded)
 *   start      the feet cell [x,y,z]
 * A node is a feet cell where the 0.6 x 1.8 body fits (feet and head cells both `swimFits`) and the feet are in water.
 * Moves: the four horizontals (the body's next column, both cells free), up (the cell over the head free), down (the cell
 * under the feet free and wet). The last move may step OUT onto a 'dry' cell: sideways at the same height, or one up
 * (the in-water collision impulse clears a 1-high ledge: prismarine-physics 499) when the cell over the current head is
 * air. Cost: cells with the head in water (breath), then length; no stretch of consecutive head-in-water cells may exceed
 * SU_MAX_WET_RUN, so turning back from any point of the plan costs at most that much breath again.
 * Prefers a 'dry' exit; an 'open' surface is taken when no dry exit is within reach.
 */
export function swimUnderPlan ({ at = () => null, start, radius = SU_RADIUS, maxDown = SU_MAX_DOWN, maxUp = SU_MAX_UP,
  maxWetRun = SU_MAX_WET_RUN, maxLen = SU_MAX_LEN } = {}) {
  const no = reason => ({ ok: false, route: [], exit: null, wet: 0, wetRun: 0, reason })
  if (!Array.isArray(start) || start.length !== 3) return no('no start')
  const [sx, sy, sz] = start
  const f0 = at(sx, sy, sz), h0 = at(sx, sy + 1, sz)
  if (!f0 || !h0) return no('terrain not loaded at the start')
  if (!isWaterCell(f0)) return no(`the feet are not in water (${f0.name})`)
  const inBox = ([x, y, z]) => Math.max(Math.abs(x - sx), Math.abs(z - sz)) <= radius && y >= sy - maxDown && y <= sy + maxUp
  // AN UNLOADED CELL IS NEVER CLEAR, AND IT IS NOT A FACT OF THE PLACE (Paper 11-03, placebo-d cut: 14 s after arriving the
  // search saw 1 node and the place backed off for the rest of the run; 30 s later the same start planned 6 cells)
  let unloaded = 0
  const seen = (x, y, z) => { const b = at(x, y, z); if (b == null && inBox([x, y, z])) unloaded++; return b }
  const node = c => inBox(c) && feetWet(seen(...c)) && swimFits(seen(c[0], c[1] + 1, c[2])) && !lavaBeside(at, c)
  // uniform-cost search on (wet, len): a heap is not worth it at <= 9 x 9 x 9 cells
  const start0 = { c: start, wet: 0, run: 0, len: 0, prev: null, headWet: headWet(h0) }
  const best = new Map([[key(start), start0]])
  const open = [start0]
  let found = null, openExit = null
  const better = (a, b) => !b || a.wet < b.wet || (a.wet === b.wet && a.len < b.len)
  while (open.length) {
    open.sort((a, b) => (a.wet - b.wet) || (a.len - b.len))
    const n = open.shift()
    if (best.get(key(n.c)) !== n) continue
    if (n.len > 0 && exitKind(at, n.c) === 'open' && better(n, openExit)) openExit = n
    if (n.len >= maxLen) continue
    const [x, y, z] = n.c
    for (const [dx, dy, dz] of DIRS) {
      const c = [x + dx, y + dy, z + dz]
      // up: the cell over the head must be free; down: the cell under the feet (the new feet cell) must be free and wet
      if (dy === 1 && !swimFits(at(x, y + 2, z))) continue
      if (!node(c)) {
        // THE STEP OUT onto dry ground: sideways at this height, or one up beside a free cell over this head
        if (dy !== 0) continue
        const up = [c[0], c[1] + 1, c[2]]
        for (const d of [c, up]) {
          if (!inBox(d) || exitKind(at, d) !== 'dry' || lavaBeside(at, d)) continue
          if (d === up) {
            const over = at(x, y + 2, z)
            if (!swimFits(over) || headWet(over)) continue       // the impulse needs the raised box free of block AND water
            if (solid(at(...c)) !== true) continue                  // the ledge is the block it collides with
          } else if (!swimFits(at(c[0], c[1] + 1, c[2]))) continue
          const t = { c: d, wet: n.wet, run: 0, len: n.len + 1, prev: n, headWet: false, dry: true }
          if (better(t, found)) found = t
        }
        continue
      }
      const hw = headWet(at(c[0], c[1] + 1, c[2]))
      const run = hw ? n.run + 1 : 0
      if (run > maxWetRun) continue
      const t = { c, wet: n.wet + (hw ? 1 : 0), run, len: n.len + 1, prev: n, headWet: hw }
      const k = key(c)
      if (better(t, best.get(k))) { best.set(k, t); open.push(t) }
    }
  }
  const pick = found ?? openExit
  if (!pick) return { ...no(`no way out within ${radius} cells (${best.size} water cells searched${unloaded ? `, ${unloaded} cell reads not loaded` : ''})`), unloaded }
  const route = []
  let wetRun = 0
  for (let n = pick; n && n.prev; n = n.prev) { route.unshift(n.c); wetRun = Math.max(wetRun, n.run) }
  return { ok: true, route, exit: found ? 'dry' : 'open', wet: pick.wet, wetRun, reason: null }
}

/** The start's neighbourhood for a refusal row: below, the four sides at the feet, the head, the roof. Pure. */
export function startCells (at, [x, y, z]) {
  const n = (dx, dy, dz) => { const b = at(x + dx, y + dy, z + dz); return b ? `${b.name}${b.isWaterlogged ? '~' : ''}` : 'unloaded' }
  return `feet=${n(0, 0, 0)} below=${n(0, -1, 0)} head=${n(0, 1, 0)} roof=${n(0, 2, 0)} N=${n(0, 0, -1)} S=${n(0, 0, 1)} E=${n(1, 0, 0)} W=${n(-1, 0, 0)}`
}

/** MAY A FIRING START -> { ok, why }. Pure. Full air and enough health; the plan itself already bounds the breath. */
export function swimUnderAdmit ({ plan, oxygen = null, health = 0, headAir = false, env } = {}) {
  if (!swimUnderOn(env)) return { ok: false, why: 'SWIMUNDER=0' }
  if (!plan?.ok) return { ok: false, why: plan?.reason ?? 'no plan' }
  // AIR UNREPORTED IS FULL AIR WHEN THE HEAD IS OUT (Paper 11-03, sandbox6): mineflayer sets oxygenLevel only from the bot's
  // own air_supply metadata, which the server sends when the air CHANGES; a bot that has breathed since it spawned never got
  // one, so the guarded reading is null (oxygen.mjs). With the eye in air the server regenerates 4 ticks of air per tick: a
  // pinned bot has had full air for hours. A null reading with the head under water is refused.
  if (!Number.isFinite(oxygen)) {
    if (headAir !== true) return { ok: false, why: 'air unreported and the head is under water: breathe first' }
  } else if (oxygen < SU_MIN_OXYGEN) return { ok: false, why: `air ${oxygen} of 20, below ${SU_MIN_OXYGEN}: breathe first` }
  if (!(health >= SU_MIN_HEALTH)) return { ok: false, why: `health ${health}, below ${SU_MIN_HEALTH}` }
  return { ok: true, why: null }
}

/**
 * THE CONTROLS FOR ONE PHYSICS TICK -> { forward, jump, look: {x,z}|null, arrived }. Pure.
 *   pos     the body's feet {x,y,z}         vel  {x,y,z} (per tick)
 *   from    the cell the move starts in     to   the cell it ends in (feet cells)
 * A sideways move first settles the feet into [from.y, from.y + SU_BAND] (the head stays under from.y + 2, so it never
 * catches the wall's top edge), then strokes toward the centre of `to` with a coast-aware brake. A vertical move first
 * centres the body in its column, then rises (jump held) or sinks (jump released: water gravity). Arrived when the feet
 * are in `to`, centred within SU_CENTRE_TOL, and -- for a sideways move -- inside the band.
 */
export function swimUnderStep ({ pos, vel = { x: 0, y: 0, z: 0 }, from, to, ceil = null }) {
  const cx = to[0] + 0.5, cz = to[2] + 0.5
  const ex = cx - pos.x, ez = cz - pos.z
  const dist = Math.hypot(ex, ez)
  const fy = Math.floor(pos.y + 1e-6)
  const vertical = to[1] !== from[1]
  const inCell = Math.floor(pos.x) === to[0] && Math.floor(pos.z) === to[2] && fy === to[1]
  const centred = Math.abs(ex) <= SU_CENTRE_TOL && Math.abs(ez) <= SU_CENTRE_TOL
  const hold = y => pos.y < y + 0.05           // jump while below the band's floor; release above it
  const stroke = () => {
    const speed = Math.hypot(vel.x ?? 0, vel.z ?? 0)
    return dist > SU_CENTRE_TOL / 2 && dist > speed * SU_COAST
  }
  if (!vertical) {
    // THE PASSAGE: the feet must be at or above the target cell's floor and low enough for the 1.8 body to pass under the
    // lower of the two columns' ceilings (`ceil`: the y of the first collision cell over the feet in either column; unknown
    // = the tightest case, to.y + 2). A body outside it does not stroke into the next column (its head would catch the
    // wall); inside it, jump keeps the feet near the floor of a tight passage and lets an open one float (no band to hunt:
    // Codex r1 note 1 -- at an open surface a band of 0.25 was never held and the stroke never ran).
    const lo = to[1], top = (Number.isFinite(ceil) ? ceil : lo + 2) - 1.8
    const fitsH = pos.y >= lo - 0.05 && pos.y <= top + 0.02
    const arrived = inCell && centred
    const inToColumn = Math.floor(pos.x) === to[0] && Math.floor(pos.z) === to[2]
    const go = !arrived && (fitsH || inToColumn) && stroke()
    const jump = pos.y < Math.min(lo + 0.3, top - 0.1)
    return { forward: go, jump, look: dist > 1e-3 ? { x: cx, z: cz } : null, arrived }
  }
  // vertical: centre first (a 0.6 body straddling the column edge catches the neighbour's block), holding the height;
  // then rise (jump held) or sink (jump released: water gravity)
  const rising = to[1] > from[1]
  const arrived = inCell && centred && (rising ? pos.y >= to[1] - 0.05 : pos.y <= to[1] + SU_BAND)
  if (!centred) return { forward: stroke(), jump: hold(from[1]), look: { x: cx, z: cz }, arrived: false }
  return { forward: false, jump: rising, look: null, arrived }
}

/** SHOULD THE FIRING TURN BACK -> reason | null. Pure. */
export function swimUnderAbort ({ oxygen = null, health = 20, health0 = 20, stepMs = 0, elapsedMs = 0, yielded = null, changed = null,
  wetAhead = null, wetBack = null } = {}) {
  if (yielded) return `yielded: ${yielded}`
  if (changed) return `the way changed: ${changed}`
  // LOW AIR TURNS BACK ONLY WHEN BACK IS THE NEARER AIR (Claude r1 note 1): with fewer head-under-water cells ahead than
  // behind, pressing on is the shorter way to a breath; the stall and budget clocks still bound it
  if (Number.isFinite(oxygen) && oxygen <= SU_ABORT_OXYGEN && !(Number.isFinite(wetAhead) && Number.isFinite(wetBack) && wetAhead < wetBack)) {
    return `air ${oxygen} of 20`
  }
  if (health < health0 - 2) return `health ${health} (from ${health0})`
  if (stepMs > SU_STEP_MS) return `no progress for ${stepMs} ms`
  if (elapsedMs > SU_BUDGET_MS) return `over the ${SU_BUDGET_MS / 1000} s budget`
  return null
}

/**
 * THE AIR THE BODY HAS LEFT when the server has not reported it -> 0..20. Pure. Vanilla: an eye in water loses 1 tick of
 * air per tick (300 = 20 units), an eye in air regains 4. Used only while `oxygen()` is null (Paper 11-03: the reading
 * stays null until the server first sends a change, i.e. until the head has been under water for a moment).
 */
export function airEstimate (prev = 20, eyeWet = false) {
  return Math.max(0, Math.min(20, prev + (eyeWet ? -1 / 15 : 4 / 15)))
}

/** The way back: the cells already taken, reversed, down to the last one where the head was in air (the start if none). */
export function swimBackRoute ({ taken = [], start, headAirAt = () => false } = {}) {
  const back = []
  for (let i = taken.length - 2; i >= -1; i--) {
    const c = i >= 0 ? taken[i] : start
    back.push(c)
    if (headAirAt(c)) break
  }
  return back
}

/** The per-place back-off after a firing that did not get out: 5, 10, 20, 40, 60 min. Pure. */
export const swimUnderBackoffMs = tries => SU_BACKOFF_MS[Math.min(Math.max(1, tries), SU_BACKOFF_MS.length) - 1]
/** The back-off after a NO-PLAN answer -> ms, or 0 (retry at the next refusal) when the search met unloaded cells. Pure. */
export const swimNoPlanBackoffMs = (tries, plan) => (plan?.unloaded > 0 ? 0
  : SU_NOPLAN_BACKOFF_MS[Math.min(Math.max(1, tries), SU_NOPLAN_BACKOFF_MS.length) - 1])

/** The `_swim_under` row's detail. Pure. */
export function swimUnderRowDetail (r = {}) {
  return `outcome=${r.outcome} exit=${r.exit ?? '-'} cells=${r.done ?? 0}/${r.len ?? 0} wet=${r.wet ?? 0} run=${r.wetRun ?? 0} ` +
         `from=${r.from ?? '-'} to=${r.to ?? '-'} min_air=${r.minAir ?? '-'} hp=${r.hp0 ?? '-'}->${r.hp1 ?? '-'} ms=${r.ms ?? 0}` +
         (r.why ? ` -- ${r.why}` : '')
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
/** The next physics tick, or 100 ms (a disconnected bot never ticks again; the firing's own clock still ends it). */
const nextTick = bot => new Promise(resolve => {
  let done = false
  const fin = () => { if (done) return; done = true; clearTimeout(t); try { bot.removeListener?.('physicsTick', fin) } catch {} ; resolve() }
  const t = setTimeout(fin, 100)
  try { bot.once('physicsTick', fin) } catch { fin() }
})

/**
 * THE ACTUATOR -> { outcome: 'out'|'returned'|'yielded'|'failed', ... }. Steers ONE body along `plan.route`, one cell at a
 * time, on the physics tick. Before each cell it re-reads that cell and the next one: a cell that no longer fits turns
 * the firing back. Turning back walks the cells already taken in reverse to the last where the head was in air (the
 * start if none), with the same controller. Every exit clears the controls it set.
 *   alive()     -> false when another owner took the body (the caller's ownership test)
 *   yieldTo()   -> reason | null: the drowning rescue or a danger move needs the body (checked every tick)
 *   oxygen()    -> the guarded air reading (0..20)
 */
export async function swimUnder (bot, { plan, alive = () => true, yieldTo = () => null, oxygen = () => bot.oxygenLevel, renew = () => {}, onStep = null, now = Date.now } = {}) {
  const t0 = now()
  const start = (p => [Math.floor(p.x), Math.floor(p.y + 1e-6), Math.floor(p.z)])(bot.entity.position)
  const res = { outcome: 'failed', exit: plan.exit, len: plan.route.length, wet: plan.wet, wetRun: plan.wetRun, done: 0,
                from: key(start), to: key(plan.route[plan.route.length - 1]), minAir: oxygen() ?? null, hp0: bot.health, hp1: bot.health, ms: 0, why: null }
  const at = (x, y, z) => { try { return bot.blockAt?.(new Vec3(x, y, z)) ?? null } catch { return null } }
  const fitsAt = c => swimFits(at(...c)) && swimFits(at(c[0], c[1] + 1, c[2]))
  let est = Number.isFinite(oxygen()) ? oxygen() : 20     // admitted with the head in air: full (swimUnderAdmit)
  const eyeWet = () => { try { const p = bot.entity.position; return headWet(at(Math.floor(p.x), Math.floor(p.y + 1.62), Math.floor(p.z))) } catch { return false } }
  // the first collision cell over the feet (y+2..y+4) in either column of a sideways move; none -> y+5
  const ceilOver = (a, b) => {
    for (let y = b[1] + 2; y <= b[1] + 4; y++) if (!swimFits(at(a[0], y, a[2])) || !swimFits(at(b[0], y, b[2]))) return y
    return b[1] + 5
  }
  const headAirAt = c => { const h = at(c[0], c[1] + 1, c[2]); return swimFits(h) && !headWet(h) }
  const set = (k, v) => { try { bot.setControlState(k, v) } catch {} }
  const clear = () => { set('forward', false); set('jump', false); set('sprint', false); set('sneak', false) }
  const look = (x, z) => { try { bot.lookAt(new Vec3(x, bot.entity.position.y + 1.62, z), true) } catch {} }
  let tBack = 0
  const drive = async (cells, back) => {
    if (back) tBack = now()
    let from = back ? null : start
    for (let i = 0; i < cells.length; i++) {
      const to = cells[i]
      from = from ?? (p => [Math.floor(p.x), Math.floor(p.y + 1e-6), Math.floor(p.z)])(bot.entity.position)
      const last = !back && i === cells.length - 1 && plan.exit === 'dry'
      if (!last && !fitsAt(to)) return { stop: `cell ${key(to)} no longer fits` }
      if (last && exitKind(at, to) !== 'dry') return { stop: `the dry exit ${key(to)} is no longer dry ground` }   // Claude r1 note 1
      const wetAt = c => { const h = at(c[0], c[1] + 1, c[2]); return headWet(h) || !swimFits(h) }
      const wetAhead = back ? null : cells.slice(i).filter(c => !(plan.exit === 'dry' && c === cells.at(-1)) && wetAt(c)).length
      const wetBack = back ? null : swimBackRoute({ taken: cells.slice(0, i + 1), start, headAirAt }).filter(wetAt).length
      const s0 = now()
      for (;;) {
        if (!alive()) return { stop: 'ownership lost', yielded: true }
        const y = yieldTo()
        if (y) return { stop: y, yielded: true }
        const rep = oxygen()
        const air = Number.isFinite(rep) ? rep : Math.floor(est)
        res.minAir = Math.min(Number.isFinite(res.minAir) ? res.minAir : 20, air)
        const ab = back ? (now() - s0 > SU_STEP_MS * 2 ? `no progress back for ${now() - s0} ms`
                           : now() - tBack > SU_BUDGET_MS ? `the way back over the ${SU_BUDGET_MS / 1000} s budget` : null)
                        : swimUnderAbort({ oxygen: air, health: bot.health, health0: res.hp0, stepMs: now() - s0, elapsedMs: now() - t0, wetAhead, wetBack })
        if (ab) return { stop: ab }
        const p = bot.entity.position
        const st = last
          ? { forward: true, jump: to[1] > from[1], look: { x: to[0] + 0.5, z: to[2] + 0.5 }, arrived: (bot.entity.onGround === true && Math.floor(p.x) === to[0] && Math.floor(p.z) === to[2] && Math.floor(p.y + 1e-6) === to[1]) }
          : swimUnderStep({ pos: p, vel: bot.entity.velocity ?? {}, from, to, ceil: to[1] === from[1] ? ceilOver(from, to) : null })
        if (onStep) onStep({ i, back, from, to, st })
        if (st.arrived) break
        if (st.look) look(st.look.x, st.look.z)
        set('forward', !!st.forward); set('jump', !!st.jump)
        await nextTick(bot)
        est = airEstimate(est, eyeWet())
      }
      if (!back) res.done = i + 1
      from = to
      renew()
    }
    return { stop: null }
  }
  try {
    clear()
    const out = await drive(plan.route, false)
    if (!out.stop) { res.outcome = 'out'; return res }
    res.why = out.stop
    if (out.yielded) { res.outcome = 'yielded'; return res }   // the rescue owns the body now: never steer against it
    // STOPPED AT AN EXIT ALREADY (Codex r1 note 2): an open surface or dry ground on the way is the goal met, not a failure
    const here = (p => [Math.floor(p.x), Math.floor(p.y + 1e-6), Math.floor(p.z)])(bot.entity.position)
    const ek = key(here) !== key(start) ? exitKind(at, here) : null
    if (ek) { res.outcome = 'out'; res.exit = ek; res.why += `; stopped at an ${ek} exit ${key(here)}`; return res }
    // TURN BACK along the wake to the last cell where the head was in air
    const back = swimBackRoute({ taken: plan.route.slice(0, res.done + 1), start, headAirAt })
    clear()
    const ret = await drive(back, true)
    res.outcome = ret.yielded ? 'yielded' : ret.stop ? 'failed' : 'returned'
    if (ret.stop) res.why += `; back: ${ret.stop}`
    return res
  } finally {
    if (res.outcome !== 'yielded') clear()   // a yield hands the body over: never one more write under the new owner (Claude r1 note 3)
    res.hp1 = bot.health
    res.ms = now() - t0
    await sleep(0)
  }
}
