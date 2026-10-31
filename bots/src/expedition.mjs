// EXPEDITION-01: SHORT SURFACE EXPEDITIONS WITH A RELIABLE WAY HOME (owner showcase list 10-29, item 5; owner 10-27
// "breadcrumbs AND markers ... I'm not worried about speed as much as making things work"; E17 caps trips at 1,200 blocks).
//
// PURE: the switch, the admission, the bearing and ring, the surface read, the leg target, the turn-back reasons, the
// breadcrumb rules, the return cursor, the marker rules, the haul. Nothing here touches a bot or a file. The visit is
// skills.mjs expeditionVisit (issued as `build_shop {expedition: true}` by shop.mjs buildOrder when the town's projects
// cannot use the bot), and skills.mjs `home` follows an open trail first (expeditionHomeLeg).
//
// WHAT A TRIP IS (one runner call; the showcase's SKILL_TIMEOUT_MS is 180 s, so the trip is sized to fit it):
//   1. a kit at town, only when the bag lacks it: a little cobble and a few torches for the markers (town chests, reserves kept)
//   2. OUT along one of 8 bearings in legs of LEG_STEP blocks to dry surface cells, never across water or into a protected
//      zone; a breadcrumb at every leg end the bot stood on; a MARKER (2 cobble + a torch, beside the route, never on it)
//      every MARKER_EVERY blocks past MARKER_MIN_HOME, not within MARKER_SPACING of a standing one (the town's marker index;
//      a later trip on the same bearing walks to those markers instead of placing new ones)
//   3. TURN at the ring distance, or at OUT_SHARE of the budget, or at once on low health / food / a full bag / dusk /
//      water / a refused leg
//   4. GATHER briefly at the turn: a few logs of a natural tree (soil under the trunk, leaves on top: never a village beam),
//      a few leaves for saplings, the drops picked up
//   5. BACK over the breadcrumbs in reverse (each hop a cell it stood on, inside view distance); a failed hop skips to the
//      next crumb, then to a marker closer to home, then the direct walk
//   6. DEPOSIT the haul in the town chests (or next call, when the clock is short)
// The trail survives the call: a trip that is still open when the call ends is followed home by `home` (and closed at town).
//
// EXPEDITION=off is the kill switch; unset = on only in EXPEDITION_POOLS (default 'showcase'). Markers alone: EXPEDITION_MARKERS=off.

export const EXPEDITION_KEY = 'expedition'
export const EXPEDITION_SLOTS = 2               // at most two bots out at once per town
export const BEARINGS = 8
export const RING_MIN = 100                     // short trips (owner: start well inside the 1,200 cap)
export const RING_MAX = 300
export const RING_STEP = 25
export const TOWN_EXIT = 36                     // the first leg's target is this + LEG_STEP out on the spoke: past the wall, not among the buildings
export const LEG_STEP = 20                      // blocks per outbound leg (inside view distance: the target chunk is loaded)
export const CRUMB_MIN = 8                      // a breadcrumb at least this far from the last one
export const CRUMB_HOP_MAX = 28                 // the return never plans a hop longer than this
export const MARKER_MIN_HOME = 48               // no marker inside the town (and its wall)
export const MARKER_EVERY = 32                  // a marker per 32 blocks of trail
export const MARKER_SPACING = 24                // never a second marker within 24 of a standing one
export const MARKER_REUSE_R = 8                 // a leg target within this of a known marker walks to the marker instead
export const ZONE_MARGIN = 8                    // protected zones (villages, chambers) are kept this far off
export const TRIP_COOLDOWN_MS = 20 * 60_000     // per bot, between trips
export const OUT_SHARE = 0.4                    // the outbound walk may use this share of the trip budget
export const GATHER_MS = 20_000
export const DEPOSIT_MIN_MS = 30_000            // the deposit runs in the same call only with this much left
export const HEALTH_START = 16, HEALTH_TURN = 12
export const FOOD_START = 12, FOOD_TURN = 6
export const ROOM_START = 6, ROOM_TURN = 2
export const DAY_START_MAX = 9_500              // ticks: a trip (3600 ticks at most) starts early enough to be home by dusk
export const DAY_TURN = 12_000                  // turn back at sunset
export const KIT = Object.freeze({ cobblestone: 12, torch: 6 })
export const TRAIL_TTL_MS = 3 * 60 * 60_000     // an open trail older than this is not followed by `home`

const OFF = ['off', '0', 'false', 'no']
const ON = ['on', '1', 'true', 'yes']
/** THE SWITCH -> bool. EXPEDITION=on|off; unset = on only in the pools EXPEDITION_POOLS names (default 'showcase'). Pure. */
export function expeditionOn (env = process.env, pool = '') {
  const v = String(env?.EXPEDITION ?? '').trim().toLowerCase()
  if (ON.includes(v)) return true
  if (OFF.includes(v)) return false
  const pools = String(env?.EXPEDITION_POOLS ?? 'showcase').split(',').map(s => s.trim()).filter(Boolean)
  return pools.includes('*') || pools.includes(String(pool))
}
export const markersOn = (env = process.env) => !OFF.includes(String(env?.EXPEDITION_MARKERS ?? '').trim().toLowerCase())

/** `_expedition_mode` licence row detail. Pure. */
export const expeditionModeDetail = (on, markers = true) =>
  `on=${on ? 1 : 0} markers=${markers ? 1 : 0} slots=${EXPEDITION_SLOTS} ring=${RING_MIN}-${RING_MAX} leg=${LEG_STEP} marker_every=${MARKER_EVERY} cooldown_min=${TRIP_COOLDOWN_MS / 60_000}`

/**
 * MAY THIS BOT GO NOW? -> { ok, phase: 'trip'|'deposit', why }. Pure. Asked by shop.mjs buildOrder at town, when the town's
 * build order has nothing for the bot: every project complete (`complete`), or its last visit stopped for want of material
 * or found nothing to do (`lastStop` 'no_material' | 'complete') -- never while a build project can use it. A haul left in the bag by a short clock is
 * deposited first (phase 'deposit', no other condition but the switch).
 */
export function expeditionAdmit ({ on = false, complete = false, lastStop = null, health = 20, food = 20, freeSlots = 36,
  timeOfDay = 0, now = 0, lastTripAt = -Infinity, pendingDeposit = false, slotFree = true } = {}) {
  if (!on) return { ok: false, why: 'off' }
  if (pendingDeposit) return { ok: true, phase: 'deposit', why: 'pending_deposit' }
  if (!complete && lastStop !== 'no_material' && lastStop !== 'complete') return { ok: false, why: 'project_open' }   // buildOrder asks only when shop.mjs buildIdle
  if (now - (Number.isFinite(lastTripAt) ? lastTripAt : -Infinity) < TRIP_COOLDOWN_MS) return { ok: false, why: 'cooldown' }
  if (health < HEALTH_START) return { ok: false, why: 'health' }
  if (food < FOOD_START) return { ok: false, why: 'food' }
  if (freeSlots < ROOM_START) return { ok: false, why: 'room' }
  const tod = ((Number(timeOfDay) % 24000) + 24000) % 24000
  if (tod > DAY_START_MAX) return { ok: false, why: 'night' }
  if (!slotFree) return { ok: false, why: 'slots_full' }
  return { ok: true, phase: 'trip', why: 'go' }
}

/** Bearing k (0..7) -> a unit vector {dx, dz} (0 = +x, 2 = +z, 4 = -x, 6 = -z). Pure. */
export function bearingVec (k, offsetDeg = 0) {
  const a = ((Number(k) || 0) * (360 / BEARINGS) + offsetDeg) * Math.PI / 180
  return { dx: Math.round(Math.cos(a) * 1e6) / 1e6, dz: Math.round(Math.sin(a) * 1e6) / 1e6 }
}

/**
 * THE RING (how far the next trip aims) from the town's trip log -> blocks. Pure. Starts at RING_MIN; every trip that reached
 * its ring and came home in its own call adds RING_STEP; every trip that did not come home in its call (late) in the last 24 h
 * takes 2 x RING_STEP off. Clamped to [RING_MIN, RING_MAX].
 */
export function ringOf (trips = [], now = 0) {
  let r = RING_MIN
  for (const t of trips) {
    if (t?.returned && t?.reason === 'reached') r += RING_STEP
    else if (!t?.returned && now - (Number(t?.t) || 0) < 24 * 60 * 60_000) r -= 2 * RING_STEP
  }
  return Math.max(RING_MIN, Math.min(RING_MAX, r))
}

/**
 * THE NEXT TRIP'S BEARING -> { bearing, reuse } | { bearing: null, why }. Pure. A bearing is BLOCKED for 24 h after a trip on it
 * turned before 40 blocks for water, a zone or a refused leg. Every other trip (odd count in 24 h) REUSES the bearing of the
 * latest trip that came home with a haul, so its markers are walked again and pushed further; otherwise the least-travelled
 * open bearing in 24 h (ties: rotation by the trip count, so the spokes fan out).
 */
export function tripBearing (trips = [], now = 0) {
  const day = trips.filter(t => now - (Number(t?.t) || 0) < 24 * 60 * 60_000)
  const blocked = new Set(day.filter(t => (Number(t?.dist) || 0) < 40 && ['water', 'zone', 'blocked'].includes(t?.reason)).map(t => t.bearing))
  if (day.length % 2 === 1) {
    const good = [...day].reverse().find(t => t?.returned && (Number(t?.haul) || 0) > 0 && !blocked.has(t.bearing))
    if (good) return { bearing: good.bearing, reuse: true }
  }
  const counts = new Map()
  for (const t of day) counts.set(t.bearing, (counts.get(t.bearing) ?? 0) + 1)
  let best = null
  for (let i = 0; i < BEARINGS; i++) {
    const k = (i + trips.length) % BEARINGS
    if (blocked.has(k)) continue
    const c = counts.get(k) ?? 0
    if (best == null || c < best.c) best = { k, c }
  }
  return best ? { bearing: best.k, reuse: false } : { bearing: null, why: 'no_bearing' }
}

// ---- the surface ----------------------------------------------------------------------------------------------------------

const LIQUID = /^(water|lava|bubble_column)$/
const CANOPY = /(_leaves|_log|_wood|^mangrove_roots|^bamboo|^vine|^cocoa)$/
const FALLING = /^(sand|red_sand|gravel|suspicious_sand|suspicious_gravel|.*concrete_powder)$/
const solid = b => !!b && b.boundingBox === 'block'
const liquid = b => !!b && (LIQUID.test(b.name ?? '') || b.waterlogged === true)
const passable = b => !!b && !solid(b) && !liquid(b)

/**
 * THE STANDABLE SURFACE CELL OF A COLUMN -> { y (feet), ground, water: false } | { water: true, y } | null (unread or none). Pure.
 * `read(x, y, z)` -> { name, boundingBox, waterlogged? } | null. Scans down from yHint + up to yHint - down: the first liquid
 * met from above is a WATER column (a lake, a river); canopy (leaves, logs) is passed through; the first other solid block with
 * two passable cells above it is the ground.
 */
export function surfaceAt (read, x, z, yHint, { up = 12, down = 20 } = {}) {
  const top = Math.floor(yHint) + up
  for (let y = top; y >= Math.floor(yHint) - down; y--) {
    const b = read(x, y, z)
    if (b == null) return null
    if (liquid(b)) return { water: true, y }
    if (!solid(b)) continue
    if (CANOPY.test(b.name ?? '')) continue
    const a1 = read(x, y + 1, z), a2 = read(x, y + 2, z)
    if (passable(a1) && passable(a2)) return { y: y + 1, ground: b.name, water: false }
  }
  return null
}

/** Is (x, z) inside a protected zone grown by `margin` (zones: [{ box: [x0,y0,z0,x1,y1,z1] }] or {x0..z1})? -> id | null. Pure. */
export function zoneHit (zones = [], x, z, margin = ZONE_MARGIN) {
  for (const q of zones ?? []) {
    const b = Array.isArray(q?.box) ? q.box : [q?.x0, q?.y0, q?.z0, q?.x1, q?.y1, q?.z1]
    if (!b.every(Number.isFinite)) continue
    if (x >= b[0] - margin && x <= b[3] + margin && z >= b[2] - margin && z <= b[5] + margin) return String(q.id ?? 'zone')
  }
  return null
}

/**
 * THE STRAIGHT LINE OF A LEG, SAMPLED -> { ok } | { ok: false, why: 'water'|'zone'|'unread', at }. Pure. Every `every` blocks from
 * `from` to `to` (x/z), the column's surface is read: a water column is a crossing (no bridging, owner 10-27: the trip turns or
 * bends instead); a protected zone (+ margin) is never entered; an unread column (outside the loaded chunks) is refused.
 */
export function lineClear (read, from, to, { zones = [], every = 3 } = {}) {
  const dx = to.x - from.x, dz = to.z - from.z
  const n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / every))
  let y = from.y
  for (let i = 1; i <= n; i++) {
    const x = Math.floor(from.x + dx * i / n), z = Math.floor(from.z + dz * i / n)
    const zid = zoneHit(zones, x, z)
    if (zid) return { ok: false, why: 'zone', at: [x, z], zone: zid }
    const s = surfaceAt(read, x, z, y)
    if (!s) return { ok: false, why: 'unread', at: [x, z] }
    if (s.water) return { ok: false, why: 'water', at: [x, z] }
    y = s.y
  }
  return { ok: true }
}

const BENDS = [0, 25, -25, 50, -50]
/**
 * THE NEXT OUTBOUND LEG -> { ok, target: {x, y, z}, via: 'marker'|'bearing', bend } | { ok: false, why }. Pure.
 * The ideal point is on the bearing's SPOKE FROM HOME, LEG_STEP past the bot's own distance along it (LIVE showcase 10-31 17:20Z:
 * aimed from the bot, a bot standing west of home on an east bearing read every target as inward and turned at 12 blocks). A known marker within MARKER_REUSE_R of it, further from home
 * than the bot by >= LEG_STEP / 2, is walked to instead (its approach cell: a cell a bot stood on). Otherwise the bearing,
 * then bends of +-25 and +-50 degrees, the first whose line is clear and whose end is a dry standable cell. All refused: the
 * most telling refusal (water before zone before unread).
 */
export function legTarget (read, { pos, home, bearing, step = LEG_STEP, markers = [], zones = [] } = {}) {
  const dHome = p => Math.hypot(p.x - home.x, p.z - home.z)
  const here = dHome(pos)
  const v0 = bearingVec(bearing)
  // ...and never a target inside the town (LIVE 17:20Z: Haven's first 20-block leg aimed among the buildings, stuck 35 s): the
  // first leg goes TOWN_EXIT + step out, and the pathfinder finds the way through the town and its wall's gateways
  const along = Math.max(TOWN_EXIT, (pos.x - home.x) * v0.dx + (pos.z - home.z) * v0.dz) + step
  const spoke = off => ({ x: home.x + v0.dx * along - v0.dz * off, z: home.z + v0.dz * along + v0.dx * off })
  const ideal = spoke(0)
  const near = k => Math.hypot(k.approach[0] - ideal.x, k.approach[2] - ideal.z)
  const m = (markers ?? [])
    .filter(k => Array.isArray(k?.approach) && near(k) <= MARKER_REUSE_R && dHome({ x: k.approach[0], z: k.approach[2] }) >= here + step / 2)
    .sort((a, b) => near(a) - near(b))[0]
  if (m) {
    const t = { x: m.approach[0], y: m.approach[1], z: m.approach[2] }
    if (lineClear(read, pos, t, { zones }).ok) return { ok: true, target: t, via: 'marker', bend: 0, marker: m.at ?? null }
  }
  const whys = []
  for (const bend of BENDS) {
    const q = spoke(Math.tan(bend * Math.PI / 180) * step)
    const x = Math.floor(q.x), z = Math.floor(q.z)
    if (dHome({ x, z }) <= here + step / 3) { whys.push('inward'); continue }
    const lc = lineClear(read, pos, { x, z, y: pos.y }, { zones })
    if (!lc.ok) { whys.push(lc.why); continue }
    const s = surfaceAt(read, x, z, pos.y)
    if (!s || s.water) { whys.push(s?.water ? 'water' : 'unread'); continue }
    return { ok: true, target: { x, y: s.y, z }, via: 'bearing', bend }
  }
  const why = ['water', 'zone', 'unread', 'inward'].find(w => whys.includes(w)) ?? 'blocked'
  return { ok: false, why }
}

/**
 * WHY TURN BACK NOW -> reason | null. Pure. In order: health, food, a full bag, dusk, being in water (a swim is travel, but
 * the outbound never sets out across water), the ring reached, the outbound share of the clock spent, two refused legs.
 */
export function turnReason ({ health = 20, food = 20, freeSlots = 36, timeOfDay = 0, inWater = false, dist = 0, ring = RING_MIN,
  elapsedMs = 0, outMs = Infinity, legFails = 0 } = {}) {
  if (health < HEALTH_TURN) return 'health'
  if (food < FOOD_TURN) return 'food'
  if (freeSlots < ROOM_TURN) return 'bag_full'
  const tod = ((Number(timeOfDay) % 24000) + 24000) % 24000
  if (tod >= DAY_TURN) return 'night'
  if (inWater) return 'water'
  if (dist >= ring) return 'reached'
  if (elapsedMs >= outMs) return 'time'
  if (legFails >= 2) return 'blocked'
  return null
}

// ---- breadcrumbs ----------------------------------------------------------------------------------------------------------

/** A cell the bot can stand on and come back to: solid non-falling ground, feet and head passable and dry. Pure. */
export function standableAt (read, [x, y, z]) {
  const g = read(x, y - 1, z), f = read(x, y, z), h = read(x, y + 1, z)
  return solid(g) && !FALLING.test(g?.name ?? '') && !liquid(g) && passable(f) && passable(h)
}
/** Record a breadcrumb at `cell`? -> bool. Pure. The first one always; then at least CRUMB_MIN from the last, on a standable cell. */
export function crumbDue (crumbs = [], cell, read = null) {
  if (read && !standableAt(read, cell)) return false
  const last = crumbs[crumbs.length - 1]
  if (!last) return true
  return Math.hypot(cell[0] - last[0], cell[2] - last[2]) >= CRUMB_MIN
}

/**
 * THE NEXT HOP HOME -> crumb index | -1. Pure. The crumbs are in outbound order (0 nearest town). From the bot, the LOWEST index
 * below `cursor` whose crumb is within CRUMB_HOP_MAX (x/z) and loaded (`loaded(cell)`), so a meander is cut short; none in
 * reach: the crumb just below the cursor (the adjacent one on the walked route), if loaded. `skip` holds indices whose hop failed.
 */
export function nextCrumb (crumbs = [], pos, cursor = crumbs.length, { loaded = () => true, skip = new Set() } = {}) {
  const top = Math.min(cursor, crumbs.length)
  for (let i = 0; i < top; i++) {
    if (skip.has(i)) continue
    const c = crumbs[i]
    if (Math.hypot(c[0] - pos.x, c[2] - pos.z) <= CRUMB_HOP_MAX && loaded(c)) return i
  }
  for (let i = top - 1; i >= 0; i--) {
    if (skip.has(i)) continue
    return loaded(crumbs[i]) ? i : -1
  }
  return -1
}

/** A marker closer to home than the bot, in hop reach -> the marker | null (the return's fallback after failed crumbs). Pure. */
export function markerHome (markers = [], pos, home, { skip = new Set() } = {}) {
  const dHome = p => Math.hypot(p[0] - home.x, p[2] - home.z)
  const here = Math.hypot(pos.x - home.x, pos.z - home.z)
  return (markers ?? []).filter(m => Array.isArray(m?.approach) && !skip.has(m.approach.join(',')) && dHome(m.approach) < here - 4 &&
    Math.hypot(m.approach[0] - pos.x, m.approach[2] - pos.z) <= CRUMB_HOP_MAX * 1.5)
    .sort((a, b) => dHome(a.approach) - dHome(b.approach))[0] ?? null
}

// ---- markers --------------------------------------------------------------------------------------------------------------

/**
 * PLACE A MARKER HERE? -> bool. Pure. Past MARKER_MIN_HOME from home, at least MARKER_EVERY of trail since this trip's last marker
 * (or its start), and no marker in the town index (or placed on this trip) within MARKER_SPACING.
 */
export function markerDue ({ pos, home, sinceLast = 0, markers = [] } = {}) {
  if (Math.hypot(pos.x - home.x, pos.z - home.z) < MARKER_MIN_HOME) return false
  if (sinceLast < MARKER_EVERY) return false
  return !(markers ?? []).some(m => Array.isArray(m?.at) && Math.hypot(m.at[0] - pos.x, m.at[2] - pos.z) < MARKER_SPACING)
}

/**
 * WHERE THE PILLAR GOES -> [x, y, z] (its base cell) | null. Pure. Beside the stand cell, off the route: the cells left and right
 * of the travel direction first, then behind -- never ahead. The base and the two cells above it passable and dry, the ground
 * under it solid, not falling, not leaves, no liquid beside the base, outside every zone (+ margin).
 */
export function markerSpot (read, stand, dir = { dx: 1, dz: 0 }, { zones = [] } = {}) {
  const ax = Math.abs(dir.dx) >= Math.abs(dir.dz)
  const fwd = ax ? [Math.sign(dir.dx) || 1, 0] : [0, Math.sign(dir.dz) || 1]
  const sides = [[-fwd[1], fwd[0]], [fwd[1], -fwd[0]], [-fwd[0], -fwd[1]]]
  for (const [ox, oz] of sides) {
    const [x, y, z] = [stand[0] + ox, stand[1], stand[2] + oz]
    if (zoneHit(zones, x, z)) continue
    const g = read(x, y - 1, z)
    if (!solid(g) || FALLING.test(g?.name ?? '') || /_leaves$/.test(g?.name ?? '') || liquid(g)) continue
    if (![0, 1, 2].every(k => { const b = read(x, y + k, z); return passable(b) && !/(torch|chest)$/.test(b?.name ?? '') })) continue
    if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, c]) => liquid(read(x + a, y, z + c)) || liquid(read(x + a, y - 1, z + c)))) continue
    return [x, y, z]
  }
  return null
}

/** A standing marker at `at` (its base): two cobblestone (a torch or nothing on top). Pure. */
export function pillarIs (read, at) {
  if (!Array.isArray(at)) return false
  const [x, y, z] = at
  return read(x, y, z)?.name === 'cobblestone' && read(x, y + 1, z)?.name === 'cobblestone'
}

// ---- gathering ------------------------------------------------------------------------------------------------------------

const SOIL = /^(dirt|grass_block|podzol|coarse_dirt|rooted_dirt|mud|moss_block|mycelium|snow_block)$/
/**
 * IS THIS LOG PART OF A NATURAL TREE? -> { ok, base, top, logs: [[x,y,z]...] (bottom up) } | { ok: false, why }. Pure. Down the
 * trunk to its base: soil under it (a village beam stands on cobble or planks). Up to its top: leaves touching the top log.
 */
export function naturalTree (read, [x, y, z], { maxH = 16 } = {}) {
  const isLog = b => /_log$/.test(b?.name ?? '')
  let b0 = y
  while (b0 > y - maxH && isLog(read(x, b0 - 1, z))) b0--
  const under = read(x, b0 - 1, z)
  if (!SOIL.test(under?.name ?? '')) return { ok: false, why: `base_on_${under?.name ?? 'unread'}` }
  let t = y
  while (t < y + maxH && isLog(read(x, t + 1, z))) t++
  let leaves = false
  for (const [a, c, d] of [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [1, 1, 0], [-1, 1, 0], [0, 1, 1], [0, 1, -1]]) {
    if (/_leaves$/.test(read(x + a, t + c, z + d)?.name ?? '')) { leaves = true; break }
  }
  if (!leaves) return { ok: false, why: 'no_leaves' }
  const logs = []
  for (let k = b0; k <= t; k++) logs.push([x, k, z])
  return { ok: true, base: [x, b0, z], top: [x, t, z], logs }
}

/** THE HAUL: what the bag gained over the trip, less the kit it drew -> { name: n }. Pure. */
export function haulOf (held0 = {}, held1 = {}, kit = {}) {
  const out = {}
  for (const [n, c] of Object.entries(held1)) {
    const d = (Number(c) || 0) - (Number(held0[n]) || 0) - (Number(kit[n]) || 0)
    if (d > 0) out[n] = d
  }
  return out
}
/** The haul worth banking: every gained item but the markers' own materials. Pure. */
export const bankableHaul = haul => Object.fromEntries(Object.entries(haul ?? {}).filter(([n, c]) => c > 0 && !/^(cobblestone|torch)$/.test(n)))

/** THE DEPOSIT'S BASELINE for matsBank (it banks what the bag holds ABOVE its baseline): the bag less the haul. Pure. */
export function depositBase (held = {}, haul = {}) {
  const base = { ...held }
  for (const [n, c] of Object.entries(haul ?? {})) base[n] = Math.max(0, (Number(held[n]) || 0) - (Number(c) || 0))
  return base
}

/** What the kit still lacks in the bag -> { name: n } (empty: nothing to draw). Only a bag below a third of the kit draws. Pure. */
export function kitNeed (held = {}, kit = KIT, markers = true) {
  if (!markers) return {}
  const out = {}
  for (const [n, want] of Object.entries(kit)) {
    const have = Number(held[n]) || 0
    if (have < Math.ceil(want / 3)) out[n] = want - have
  }
  return out
}

/** `_expedition_trip` row detail (under 300 characters). Pure. */
export function tripDetail (t = {}) {
  const haul = Object.entries(t.haul ?? {}).map(([k, v]) => `${k}:${v}`).join(',') || '-'
  return `trip=${t.id ?? '-'} bearing=${t.bearing ?? '-'} ring=${t.ring ?? '-'} dist=${Math.round(t.dist ?? 0)} reason=${t.reason ?? '-'} returned=${t.returned ? 1 : 0} via=${t.via ?? '-'} crumbs=${t.crumbs ?? 0} markers=${t.markers ?? 0} reused=${t.reused ?? 0} deposited=${t.deposited ?? 0} ms=${t.ms ?? 0} haul=${haul}`.slice(0, 295)
}
