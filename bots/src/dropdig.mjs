// DROPANDDIG-01: DIG THE AIR POCKET STANDING. docs/reports/dropdig-01-2026-11-04.md (design: dropdig-design-2026-11-03.md s7).
//
// MEASURED (fleet files, 80 bots, 11-01 20:15Z -> 11-04 08:00Z = 59.75 h after apseal-01; 4,890,832 rows, 54 deaths):
//   23 drownings; 11 had the air pocket refused on its TIME budget ("needs N ms, budget M ms") in the 400 s before. The
//   drowning rescue holds jump, so the bot floats pressed against its roof (y = N.2) and the dig is priced and performed
//   floating with the eye in water: prismarine-block digTime x5 (eye in water) x5 (not on ground) = 25x. Standing it is 5x
//   (sandbox: stone, stone pickaxe, 2.9 s standing vs 14.1 s floating).
//   Floor under those 11 feet cells, read from region copies of the 11-04 03:16Z backup (failmine Regions, read-only):
//   dy -1: 3, dy -2: 2, dy -3: 1, dy -4: 1, dy -5/-6 (ice roofs, health already low): 3, none within 6: 1.
//   So 5 of 23 drownings (~2.0/day) had a floor within 2 cells; 4 of the 5 fit the standing price below at the health of
//   their first refusal (placebo-d-Bravo's first refusal came at 8 HP: still refused).
//
// WHAT: only when the FLOATING price is refused on the health budget (the 70 pocket steps that already run are untouched,
// and the pre-empt of an in-flight escape still prices the floating worst case), and only over a verified full-cube floor
// within 2 cells under every column the body overlaps, the step releases jump, sinks onto the floor, digs the SAME roof
// cell standing (absolute coordinates, never re-planned from the floor), then rises into the pocket. Admission prices the
// sink, the extra rise, the seals and the standing dig together. A sink that never lands re-asserts jump and returns
// nothing dug (the short 5-s refusal cooldown) and the cell is not dropped from again for 60 s: the next tick refuses
// exactly as the base does. No new dead end: the base had already refused here.
//
// prismarine-physics 1.11.1 at 1.21.8 (bots/test/dropdig.test.mjs S1): pinned at N.2, jump released, a floor at dy -1 is
// reached in 12 ticks (0.6 s), at dy -2 in 52 ticks (2.6 s). The sink deadline is 1000 + 2500 ms per block of descent
// (1.5 s / 4.0 s). Upstream: mineflayer PR #3136 prices the in-water penalty at EYE level; PR #3930 (open) notes the dig
// time is fixed when the dig starts, so the body must stay grounded through the dig (jump stays off, a lift-off aborts).
//
// DROPANDDIG=0 restores the base exactly (no drop is ever offered).

export const DD_MAX_DEPTH = 2                 // floors at dy -1 or -2 only (the measured 5; dy -3 is a 2.2-block sink)
export const DD_SINK_BASE_MS = 1000           // sink deadline = base + per block of descent (S1: 0.6 s / 2.6 s simulated)
export const DD_SINK_PER_BLOCK_MS = 2500
export const DD_RISE_PER_BLOCK_MS = 1500      // the extra rise back to the roof, per block of descent
export const DD_REACH = 4.5                   // eye -> target cell centre (vanilla server allows interaction range + 1)
export const DD_FAIL_MEMORY_MS = 60_000       // a sink that never landed is not tried again from that cell for this long
export const DD_LAND_TICKS = 3                // landed = this many consecutive polls on the ground, still, in the column
export const DD_LAND_POLL_MS = 50

export const dropDigOn = (env = typeof process !== 'undefined' ? process.env : {}) =>
  !/^(0|off|false|no)$/i.test(String(env?.DROPANDDIG ?? '1').trim())

const PLAIN_WATER = /^(water|flowing_water)$/
// floors a body must not stand on here: damage, bounce, stick, sink, fall, or a partial collision shape
const BAD_FLOOR = /lava|^magma_block$|^fire$|^soul_fire$|^campfire$|^soul_campfire$|^soul_sand$|^soul_soil$|^mud$|^slime_block$|^honey_block$|^powder_snow$|^scaffolding$|^farmland$|^dirt_path$|cactus|sweet_berry|pointed_dripstone|^sand$|^red_sand$|^gravel$|concrete_powder$|^suspicious_(sand|gravel)$|anvil$|^dragon_egg$/

function props (b) {
  try { return (typeof b?.getProperties === 'function' ? b.getProperties() : (b?._properties ?? b?.properties)) ?? {} } catch { return {} }
}
/** Plain, still water: the only thing a body sinks through here (no bubble column, kelp, seagrass, current). Pure. */
export function stillWater (b) {
  if (!b || !PLAIN_WATER.test(b.name || '')) return false
  const lv = props(b).level
  return lv == null || Number(lv) === 0
}
/** A full 1x1x1 collision cube. `shapes` (prismarine-block) when present; otherwise boundingBox 'block'. Pure. */
export function fullCube (b) {
  if (!b || b.boundingBox !== 'block') return false
  if (Array.isArray(b.shapes)) {
    return b.shapes.length === 1 && b.shapes[0].length === 6 &&
      b.shapes[0].every((v, i) => Math.abs(v - (i < 3 ? 0 : 1)) < 1e-9)
  }
  return true
}

/** The block columns a 0.6-wide body at (x, z) overlaps (1 to 4). Pure. */
export function footprint (x, z, half = 0.3) {
  const xs = [...new Set([Math.floor(x - half + 1e-6), Math.floor(x + half - 1e-6)])]
  const zs = [...new Set([Math.floor(z - half + 1e-6), Math.floor(z + half - 1e-6)])]
  const out = []
  for (const cx of xs) for (const cz of zs) out.push([cx, cz])
  return out
}

/**
 * IS THERE A FLOOR TO STAND ON, WITHIN 2 CELLS? Pure. `at(x, y, z)` -> block (null = unknown) in ABSOLUTE coordinates.
 * For every column the body overlaps: the cells from the feet cell down are still plain water until the first non-water
 * cell, and that cell (if within 2) is a known, full, harmless cube. The body's OWN column must have one. The landing
 * height is the highest such floor top; the eye cell there must be plain water (the client prices the dig with the eye
 * in water; seagrass or kelp at the eye would make the client and server disagree).
 * -> { ok, why, landY, depth, descent }   depth = cells below the feet cell; descent = blocks the body sinks
 */
export function dropFloor (at, { pos, fx, fy, fz }) {
  const no = (why) => ({ ok: false, why, landY: null, depth: null, descent: null })
  if (!pos || ![pos.x, pos.y, pos.z].every(Number.isFinite)) return no('no position')
  if (Math.floor(pos.x) !== fx || Math.floor(pos.z) !== fz || Math.floor(pos.y) !== fy) return no('not in the planned cell')
  let ownDepth = null, minDepth = null
  for (const [cx, cz] of footprint(pos.x, pos.z)) {
    const own = cx === fx && cz === fz
    let found = null
    for (let k = 0; k <= DD_MAX_DEPTH; k++) {
      const b = at(cx, fy - k, cz)
      if (b == null) return no(`cell ${cx},${fy - k},${cz} unknown`)
      if (stillWater(b)) continue
      if (k === 0) return no(`${b.name} in the feet row at ${cx},${cz}`)
      if (PLAIN_WATER.test(b.name || '')) return no(`moving water at ${cx},${fy - k},${cz} (a current carries the body)`)
      if (BAD_FLOOR.test(b.name || '') || !fullCube(b)) return no(`${b.name} under the body is not a floor`)
      found = k; break
    }
    if (own && found == null) return no(`no floor within ${DD_MAX_DEPTH}`)
    if (found != null && (minDepth == null || found < minDepth)) minDepth = found
    if (own) ownDepth = found
  }
  if (ownDepth == null) return no(`no floor within ${DD_MAX_DEPTH}`)
  const landY = fy - minDepth + 1
  const eye = at(fx, Math.floor(landY + 1.62), fz)
  if (eye == null) return no('eye cell unknown')
  if (!stillWater(eye)) return no(`eye would be in ${eye.name}, not plain water`)
  const descent = Math.max(0, pos.y - landY)
  return { ok: true, why: null, landY, depth: minDepth, descent }
}

/** Distance from a standing eye to a cell's centre. Pure. */
export function reachTo (eye, cell) {
  const dx = cell.x + 0.5 - eye.x, dy = cell.y + 0.5 - eye.y, dz = cell.z + 0.5 - eye.z
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

/**
 * MAY THE STEP DIG STANDING? Pure. Everything absolute: the roof cell (fx, fy + plan.dy, fz) and each seal cell stay
 * where the floating plan put them. Required = sink deadline + extra rise + seals + standing dig x margin + latency,
 * against the same health budget the floating price was refused on.
 * -> { ok, why, requiredMs, budgetMs, sinkMs, riseExtraMs }
 */
export function standingPlan ({ floor, plan, fx, fy, fz, x = fx + 0.5, z = fz + 0.5, digStandingMs, budgetMs,
                                margin = 1.5, latencyMs = 3000, sealMs = 1500 }) {
  const no = (why, extra = {}) => ({ ok: false, why, requiredMs: null, budgetMs, sinkMs: null, riseExtraMs: null, ...extra })
  if (!floor?.ok) return no(floor?.why ?? 'no floor')
  if (!plan?.ok || plan.kind !== 'pocket') return no(`plan ${plan?.kind ?? 'refused'}: standing applies to a dug pocket only`)
  if (!(Number.isFinite(digStandingMs) && digStandingMs > 0)) return no('standing dig time unknown')
  const eye = { x, y: floor.landY + 1.62, z }
  const targets = [{ x: fx, y: fy + plan.dy, z: fz }, ...(plan.seal ?? []).map(s => ({ x: fx + s.dx, y: fy + s.dy, z: fz + s.dz }))]
  const far = Math.max(...targets.map(c => reachTo(eye, c)))
  if (far > DD_REACH) return no(`a target is ${far.toFixed(2)} from the standing eye (reach ${DD_REACH})`)
  const sinkMs = DD_SINK_BASE_MS + DD_SINK_PER_BLOCK_MS * floor.descent
  const riseExtraMs = DD_RISE_PER_BLOCK_MS * floor.descent
  const seals = Math.max(0, (plan.seal?.length ?? 0) | 0)
  const requiredMs = sinkMs + riseExtraMs + seals * sealMs + digStandingMs * margin + latencyMs
  const ok = requiredMs <= budgetMs
  return { ok, why: ok ? null : `standing needs ${Math.round(requiredMs)} ms, budget ${Math.round(budgetMs)} ms`,
           requiredMs, budgetMs, sinkMs, riseExtraMs }
}

/**
 * IS A DROP EVEN ASKED? Pure. Only for the step's own admission (never the pre-empt's worst case), only floating, only
 * when the floating price was refused on the health budget, never from a cell whose sink failed in the last 60 s.
 */
export function dropEligible ({ on = dropDigOn(), worstCase = false, onGround = false, budgetRefused = false,
                                failedUntil = 0, now = Date.now() } = {}) {
  if (!on || worstCase || onGround || !budgetRefused) return false
  return !(now < failedUntil)
}

/** Landed? Pure. The last DD_LAND_TICKS polls: on the ground, still, in the planned column, at or above the floor. */
export function landed (samples = [], { fx, fz, landY }) {
  if (samples.length < DD_LAND_TICKS) return false
  return samples.slice(-DD_LAND_TICKS).every(s => s.onGround === true && Math.abs(s.vy ?? 0) < 0.05 &&
    Math.floor(s.x) === fx && Math.floor(s.z) === fz && s.y >= landY - 0.03)
}

/**
 * THE SINK. Impure, never throws. Jump released (and re-asserted released every poll: nothing else may lift the body),
 * horizontal controls off; polls every 50 ms until `landed` or the deadline. `isAborted()` -> a reason stops it.
 * -> { ok, ms, why, y }
 */
export async function dropSink (bot, drop, { fx, fz, sleep = ms => new Promise(r => setTimeout(r, ms)), now = () => Date.now(),
                                             isAborted = () => null } = {}) {
  const t0 = now()
  const samples = []
  try {
    for (const c of ['jump', 'forward', 'back', 'left', 'right', 'sprint', 'sneak']) { try { bot.setControlState(c, false) } catch {} }
    while (now() - t0 < drop.sinkMs) {
      const a = isAborted()
      if (a) return { ok: false, ms: now() - t0, why: `aborted: ${a}`, y: bot.entity?.position?.y ?? null }
      try { if (bot.controlState?.jump) bot.setControlState('jump', false) } catch { /* not connected */ }
      const p = bot.entity?.position
      if (p) samples.push({ onGround: bot.entity.onGround === true, vy: bot.entity.velocity?.y ?? 0, x: p.x, y: p.y, z: p.z })
      if (landed(samples, { fx, fz, landY: drop.landY })) return { ok: true, ms: now() - t0, why: null, y: p.y }
      if (p && (Math.floor(p.x) !== fx || Math.floor(p.z) !== fz)) return { ok: false, ms: now() - t0, why: 'drifted off the column', y: p.y }
      await sleep(DD_LAND_POLL_MS)
    }
    return { ok: false, ms: now() - t0, why: `no landing in ${Math.round(drop.sinkMs)} ms`, y: bot.entity?.position?.y ?? null }
  } catch (e) {
    return { ok: false, ms: now() - t0, why: `threw: ${String(e?.message ?? e).slice(0, 40)}`, y: null }
  }
}

/** The row tag for a step that dropped: `drop=<depth>:<landed|fail>:<ms>`. Pure. */
export function dropTag (drop, sink) {
  if (!drop) return null
  return `${drop.depth}:${sink ? (sink.ok ? 'landed' : 'fail') : 'none'}:${sink ? Math.round(sink.ms) : -1}`
}
