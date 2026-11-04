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
// WHOLEMAP-S1a (docs/reports/wholemap-expeditions-design-2026-11-01.md section 4 S1): a zone UNDER the walk is walked over
// (zoneHit surfaceY); a zone on the spoke is walked ROUND (zoneDetour / detourLeg, the shorter side, then the other); a bearing
// is dead after two obstacle turns short of the ring (deadBearings, this planner's rows only); no marker torch by ice
// (torchSafe); a ring past ONE_CALL_RING is a multi-call trip (more of the call out; the trail home may finish next call, by
// `home`, and counts for the ring); a late close near town costs the ring nothing; the ring grows 100 -> 300.
// EXPEDITION=off is the kill switch; unset = on only in EXPEDITION_POOLS (default 'showcase'). Markers alone: EXPEDITION_MARKERS=off.
//
// EXPWATER-01 (owner 11-01 "water/boats/bridges OK", 11-03 "do it"; docs/reports/expwater-design-2026-11-03.md): a leg may SWIM a
// narrow water crossing. Every dry bend is tried first (a walk round still wins); then the same bends again with water allowed: at
// most SWIM_MAX wet columns in the leg, each a WATER surface (never lava, never a bubble column) no more than SWIM_DROP below the
// bank, and both shores LEVEL with the water (SWIM_EXIT: the pathfinder with the bots' shore egress never planned a one-block-up exit in
// Paper). The
// pathfinder swims it (index.mjs: a wet step costs ~2, entering 1). A crossing gets a breadcrumb on BOTH shores, so the way home
// swims back over the same water. Wider water still turns the trip, its width logged (`swim_wide:N`) for a boat or bridge piece.
// Measured 11-03 on the showcase: from all four live water walls the planner reaches the 300 ring (crossings of 2-16 columns). EXPEDITION_SWIM=off: dry legs only.

import { cellsSeenFrom, unseen as atlasUnseen } from './atlas.mjs'   // atlas-01: the trip's aim from the bots' shared map
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
export const TRAIL_TTL_MS = 3 * 60 * 60_000     // an open trail not walked for this long is not followed by `home` (per leg: wholemap-s1)
// WHOLEMAP-S1a (docs/reports/wholemap-expeditions-design-2026-11-01.md section 4 S1, items 1-3, 5, 6): 300-block trips
export const PLANNER_V = 3                      // trip rows written by this planner carry v: 3; only they block a bearing (an older row was another planner's: expwater-01's v 3 swims, so a v 2 'water' turn says nothing about it)
export const ZONE_UNDER = 8                     // a zone whose box top is >= this far below the surface is under the walk (the trial chambers: y <= 31, grass at 66)
export const DEAD_TURNS = 2                     // two obstacle turns on one bearing in 24 h block it for the rest of the day (any distance short of the ring)
export const DETOUR_PAD = 10                    // the detour walks the zone's box grown by ZONE_MARGIN + this (its edges stay outside the margin)
export const DETOUR_ARRIVE = 4                  // a detour waypoint is passed within this (x/z)
export const ONE_CALL_RING = 225                // a ring beyond this is a MULTI-CALL trip: more of the call goes out, the trail home may finish next call
export const LONG_OUT_SHARE = 0.6               // a multi-call trip's outbound share of its call
export const ICE_TORCH_R = 3                    // no marker torch within this (a cube) of `ice` (block light > 11 melts it: a hole in the road)
// EXPWATER-01
export const SWIM_MAX = 16                      // wet columns a leg may swim (Paper 11-03, the bots' walk prices + shore egress, level shores: 8 wide 20/20, 14 wide 19/20, 20 wide 18/20)
export const SWIM_DROP = 4                      // the water's surface at most this far below the bank it is entered from (no ravine plunge)
export const SWIM_EXIT = 1                      // a shore's stand cell at most this far above the water block: LEVEL with the water (Paper 11-03: a one-block-up shore planned 0 of 10 exits)
export const SHORE_INLAND = 3                   // a swim leg's target lies this far past the first dry cell (goto's range 2 never stops it wet)
export const SHORE_BACK = 4                     // a shore leg may give back this much distance from home (a crossing at a wide bend), no more: no shore-to-shore shuttle
export const SHORE_NEAR = 8                     // a swim leg starts within this of the water; further, a dry leg to the near shore comes first (> 4: the visit's legFails counts a leg that moved < 4 as refused)
export const SWIM_REACH = SWIM_MAX + 4          // a swim leg's end may lie this far past its dry end point, to reach the far shore
export const EXIT_RETRY_MS = 3 * 60 * 60_000    // a refused walk ('blocked') short of 40 blocks blocks its bearing this long, not the whole day

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
/** EXPWATER-01: how wide a crossing a leg may swim -> wet columns (0: dry legs only, the 11-02 planner). EXPEDITION_SWIM=off|0 -> 0;
 *  a number -> that width (1..24: an operator narrows it to 8 -- 20/20 in Paper -- if live crossings strand); unset/on -> SWIM_MAX. Pure. */
export function swimWidth (env = process.env) {
  const v = String(env?.EXPEDITION_SWIM ?? '').trim().toLowerCase()
  if (OFF.includes(v)) return 0
  const n = Number(v)
  if (v !== '' && Number.isFinite(n)) return Math.max(0, Math.min(24, Math.floor(n)))
  return SWIM_MAX
}
export const swimOn = (env = process.env) => swimWidth(env) > 0

/** `_expedition_mode` licence row detail. Pure. */
export const expeditionModeDetail = (on, markers = true, swim = 0) =>
  `on=${on ? 1 : 0} markers=${markers ? 1 : 0} swim=${swim === true ? SWIM_MAX : Number(swim) || 0} slots=${EXPEDITION_SLOTS} ring=${RING_MIN}-${RING_MAX} leg=${LEG_STEP} marker_every=${MARKER_EVERY} cooldown_min=${TRIP_COOLDOWN_MS / 60_000}`

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
  // idlekeep-01: `keeper_held` (the only open project is another bot's grounds) is idle as no_material is (shop.mjs IDLE_STOPS)
  if (!complete && lastStop !== 'no_material' && lastStop !== 'keeper_held' && lastStop !== 'complete') return { ok: false, why: 'project_open' }   // buildOrder asks only when shop.mjs buildIdle
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
    // bridgepost-01: a BRIDGE trip went to work at a site, not to its ring: it says nothing about the ring's reach
    if (t?.bridge) continue
    // atlas-01: a HARVEST trip's ring was its wood's distance, not the town's reach
    if (t?.mode === 'harvest') continue
    // a MULTI-CALL trip (wholemap-s1 item 6) that reached its ring and came home over its own trail in a later call is a success
    const trail = t?.multi === true && /^home_/.test(String(t?.via ?? ''))
    if ((t?.returned || trail) && t?.reason === 'reached') r += RING_STEP
    else if (!t?.returned && !trail && now - (Number(t?.t) || 0) < 24 * 60 * 60_000 &&
      // a late close near town (a stuck in the town's streets, an interrupt at 12 blocks) says nothing about the ring's reach
      (Number(t?.dist) || 0) >= (Number(t?.ring) || RING_MIN) / 2) r -= 2 * RING_STEP
  }
  return Math.max(RING_MIN, Math.min(RING_MAX, r))
}
/** A trip on `ring` is a MULTI-CALL trip (more of the call goes out; its trail home may finish in a later call) -> bool. Pure. */
export const multiCall = ring => (Number(ring) || 0) > ONE_CALL_RING
/** The outbound share of a trip's call -> fraction. Pure. */
export const outShareOf = ring => multiCall(ring) ? LONG_OUT_SHARE : OUT_SHARE
/**
 * How old an open trail is, for `home`'s TRAIL_TTL_MS and the slot count -> ms. Pure. Since its last leg that MOVED the bot (trailAt;
 * a stuck bot's failed hops never stamp it), else its start; and a trip older than TRIP_MAX_MS from its start is past every TTL
 * (Claude review r1 BLOCK: a bot stuck out of town must not hold an expedition slot for ever).
 */
export const TRIP_MAX_MS = 12 * 60 * 60_000
export function trailAge (trip = {}, now = 0) {
  const t0 = Number(trip?.startedAt) || 0
  if (now - t0 > TRIP_MAX_MS) return Infinity
  return now - (Number(trip?.trailAt) || t0)
}

/**
 * THE NEXT TRIP'S BEARING -> { bearing, reuse } | { bearing: null, why }. Pure. A bearing is BLOCKED for 24 h after a trip on it
 * turned before 40 blocks for water, a zone or a refused leg. Every other trip (odd count in 24 h) REUSES the bearing of the
 * latest trip that came home with a haul, so its markers are walked again and pushed further; otherwise the least-travelled
 * open bearing in 24 h (ties: rotation by the trip count, so the spokes fan out).
 */
export function tripBearing (trips = [], now = 0) {
  const day = trips.filter(t => now - (Number(t?.t) || 0) < 24 * 60 * 60_000 && (Number(t?.v) || 0) >= PLANNER_V)
  const blocked = deadBearings(day, now)
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

const OBSTACLE = ['water', 'zone', 'blocked', 'drop', 'steep', 'unread']
/**
 * THE DEAD BEARINGS of a day's trip rows -> Set of bearings. Pure. A bearing is dead after ONE obstacle turn (water, a zone, a
 * refused leg) before 40 blocks, or after DEAD_TURNS obstacle turns at any distance short of the trip's ring (wholemap-s1 item
 * 1: LIVE 10-31..11-01, 38 trips on bearing 2 hit the same zone at 54-55 blocks and the < 40 rule never fired).
 */
export function deadBearings (day = [], now = null) {
  const n = new Map(), out = new Set()
  for (const t of day) {
    if (!OBSTACLE.includes(t?.reason)) continue
    const d = Number(t?.dist) || 0
    // EXPWATER-01: a REFUSED WALK near town (the leg's goto moved < 4 blocks twice: a bot in the street, a gateway being built) says
    // nothing about the bearing's ground -- it blocks for EXIT_RETRY_MS, not the day (LIVE 11-03 12:10Z: five of the eight dead
    // bearings were 'blocked' at 19-34 blocks)
    if (d < 40 && t.reason === 'blocked' && Number.isFinite(now) && now - (Number(t?.t) || 0) >= EXIT_RETRY_MS) continue
    if (d < 40) { out.add(t.bearing); continue }
    if (d < (Number(t?.ring) || RING_MIN)) n.set(t.bearing, (n.get(t.bearing) ?? 0) + 1)
  }
  for (const [k, c] of n) if (c >= DEAD_TURNS) out.add(k)
  return out
}

// ---- atlas-01: the trip's aim from the bots' shared map (atlas.mjs) ------------------------------------------------------------
//
// LIVE before this (BlueMap, owner 11-04): every trip walked one of eight fixed spokes and came home on it, and every other trip
// re-walked the last good spoke, so the map grew eight lines. The bearing (0..7) stays the unit of the day's bookkeeping -- dead
// bearings, the reuse rule, the bridge sites, the per-bearing reads -- and the AIM is a fractional bearing inside its wedge
// (bearingVec takes k + offset/45; legTarget, zoneDetour and beyondGain all go through it), so the spokes become a fan.

export const AIM_OFFSETS = Object.freeze([-18, -9, 0, 9, 18])   // degrees inside the 45-degree wedge (its edges stay +-22.5)
export const AIM_STEP = 16                                       // the swath is sampled every this many blocks along the aim
export const HARVEST_MIN = 64                                    // wood nearer than this is the town's (the groundskeeper's)
export const HARVEST_PAST = 8                                    // a harvest trip turns this far past the wood's find
export const HARVEST_FRESH_MS = 2 * 24 * 60 * 60_000             // a wood find older than this is not walked to
export const HARVEST_CLUSTER_R = 40

const rad = deg => deg * Math.PI / 180
/** The bearing index (0..7) whose wedge holds the angle from home to (x, z). Pure. */
export const wedgeOf = (home, x, z) => ((Math.round(Math.atan2(z - home.z, x - home.x) / rad(360 / BEARINGS)) % BEARINGS) + BEARINGS) % BEARINGS
/** The fractional bearing (k + offset/45) pointing from home at (x, z). Pure. */
export const aimAt = (home, x, z) => { const a = Math.atan2(z - home.z, x - home.x) / rad(360 / BEARINGS); return ((a % BEARINGS) + BEARINGS) % BEARINGS }

/**
 * THE FRONTIER AIM -> { k, aim, unseen, cells } | null. Pure. For each open bearing (in `order`) and each offset, the swath a trip on
 * that aim would notice (atlas cellsSeenFrom every AIM_STEP from TOWN_EXIT to `ring`) is counted for cells nobody has seen within
 * FRESH_MS. The largest count wins; ties keep `order` (the least-travelled rotation), then the smaller offset. Every swath fully
 * seen -> null (the caller keeps the old pick).
 */
export function frontierAim (view, { home, ring = RING_MIN, dead = new Set(), order = null, now = Date.now(), border = 5000 } = {}) {
  if (!view?.cells || !home) return null
  const ks = (order ?? Array.from({ length: BEARINGS }, (_, i) => i)).filter(k => !dead.has(k))
  let best = null
  for (const k of ks) {
    for (const off of [...AIM_OFFSETS].sort((a, b) => Math.abs(a) - Math.abs(b))) {
      const v = bearingVec(k, off)
      const keys = new Set()
      for (let d = TOWN_EXIT; d <= ring; d += AIM_STEP) {
        const x = home.x + v.dx * d, z = home.z + v.dz * d
        if (Math.abs(x) > border || Math.abs(z) > border) break
        for (const key of cellsSeenFrom(x, z)) keys.add(key)
      }
      let n = 0
      for (const key of keys) if (atlasUnseen(view.cells, key, now)) n++
      if (!best || n > best.unseen) best = { k, aim: k + off / (360 / BEARINGS), unseen: n, cells: keys.size, off }
    }
  }
  return best && best.unseen > 0 ? best : null
}

/**
 * THE HARVEST AIM -> { k, aim, ring, find } | null. Pure. The wood find the map knows with the most wood around it (finds of the
 * wood category within HARVEST_CLUSTER_R, each weighted by its sightings), HARVEST_MIN..maxRing from home, seen within
 * HARVEST_FRESH_MS, outside every protected zone, on an open bearing. Ties: nearer. The trip's ring is the find's distance +
 * HARVEST_PAST, so it turns -- and its turn gather (exGather) fells -- at the trees.
 */
export function harvestAim (view, { home, maxRing = RING_MAX, dead = new Set(), zones = [], now = Date.now() } = {}) {
  if (!view?.finds || !home) return null
  const wood = view.finds.filter(f => f.cat === 'wood' && now - (f.last ?? 0) <= HARVEST_FRESH_MS)
  let best = null
  for (const f of wood) {
    const d = Math.hypot(f.x - home.x, f.z - home.z)
    if (d < HARVEST_MIN || d + HARVEST_PAST > maxRing) continue
    if (zoneHit(zones, f.x, f.z, ZONE_MARGIN, { surfaceY: f.y })) continue
    const k = wedgeOf(home, f.x, f.z)
    if (dead.has(k)) continue
    const mass = wood.filter(q => Math.hypot(q.x - f.x, q.z - f.z) <= HARVEST_CLUSTER_R).reduce((a, q) => a + Math.min(Number(q.n) || 1, 10), 0)
    if (!best || mass > best.mass || (mass === best.mass && d < best.d)) best = { k, aim: aimAt(home, f.x, f.z), ring: Math.ceil(d + HARVEST_PAST), mass, d, find: { kind: f.kind, x: f.x, y: f.y, z: f.z, n: f.n, by: f.by } }
  }
  return best
}

/**
 * THE NEXT TRIP -> { bearing, aim, reuse, mode, ring?, unseen?, find? } | { bearing: null, why }. Pure. `tripBearing`'s answer
 * is kept for every no-map case (`view` null: ATLAS off, the exact old planner). With the map: an odd trip of the day HARVESTS
 * (the densest known wood; none: the old reuse), an even trip goes to the FRONTIER (the most unseen swath; all seen: the old
 * least-travelled pick). Dead bearings are the old rule's, so a wedge that turned trips for water stays shut for the day.
 */
export function planTrip (trips = [], now = 0, { view = null, home = null, ring = RING_MIN, zones = [] } = {}) {
  const base = tripBearing(trips, now)
  if (base.bearing == null) return base
  const plain = { ...base, aim: base.bearing, mode: base.reuse ? 'reuse' : 'least' }
  if (!view || !home) return plain
  const day = trips.filter(t => now - (Number(t?.t) || 0) < 24 * 60 * 60_000 && (Number(t?.v) || 0) >= PLANNER_V)
  const dead = deadBearings(day, now)
  if (day.length % 2 === 1) {
    const h = harvestAim(view, { home, maxRing: RING_MAX, dead, zones, now })
    return h ? { bearing: h.k, aim: h.aim, reuse: false, mode: 'harvest', ring: h.ring, find: h.find, mass: h.mass } : plain
  }
  const order = Array.from({ length: BEARINGS }, (_, i) => (base.bearing + i) % BEARINGS)
  const f = frontierAim(view, { home, ring, dead, order, now })
  return f ? { bearing: f.k, aim: f.aim, reuse: false, mode: 'frontier', unseen: f.unseen, cells: f.cells } : plain
}

// ---- the surface ----------------------------------------------------------------------------------------------------------

const LIQUID = /^(water|lava|bubble_column)$/
const CANOPY = /(_leaves|_log|_wood|^mangrove_roots|^bamboo|^vine|^cocoa)$/
const FALLING = /^(sand|red_sand|gravel|suspicious_sand|suspicious_gravel|.*concrete_powder)$/
const solid = b => !!b && b.boundingBox === 'block'
// expwater-01 (Claude review r1 BLOCKER): kelp and seagrass are always under water, and the reader gives them no waterlogged flag -- a
// kelp column read as dry ground on the lake bed, and a swim leg aimed 12 blocks under the surface
const AQUATIC = /^(kelp|kelp_plant|seagrass|tall_seagrass)$/
const liquid = b => !!b && (LIQUID.test(b.name ?? '') || AQUATIC.test(b.name ?? '') || b.waterlogged === true)
const passable = b => !!b && !solid(b) && !liquid(b)

/**
 * THE STANDABLE SURFACE CELL OF A COLUMN -> { y (feet), ground, water: false } | { water: true, y } | { none: true } (read, but no
 * standable cell in the window: a trunk, a wall, a cliff) | null (unread: outside the loaded chunks). Pure.
 * `read(x, y, z)` -> { name, boundingBox, waterlogged? } | null. Scans down from yHint + up to yHint - down: the first liquid
 * met from above is a WATER column (a lake, a river); canopy (leaves, logs) is passed through; the first other solid block with
 * two passable cells above it is the ground.
 */
export function surfaceAt (read, x, z, yHint, { up = 12, down = 20 } = {}) {
  const top = Math.floor(yHint) + up
  let ground = false
  for (let y = top; y >= Math.floor(yHint) - down; y--) {
    const b = read(x, y, z)
    if (b == null) return null
    if (liquid(b)) return { water: true, y, liquid: LIQUID.test(b.name ?? '') ? b.name : 'water' }
    if (!solid(b)) continue
    if (CANOPY.test(b.name ?? '')) continue
    ground = true
    const a1 = read(x, y + 1, z), a2 = read(x, y + 2, z)
    if (passable(a1) && passable(a2)) return { y: y + 1, ground: b.name, water: false }
  }
  // read, nowhere to stand: OBSTRUCTED when the scan met ground under something (a trunk on its soil, a wall); an all-air column is
  // a DROP whose bottom (water, perhaps) lies below the window (Codex r7 BLOCK: a ravine over water read as "none")
  return { none: true, obstructed: ground }
}

/**
 * Is (x, z) inside a protected zone grown by `margin` (zones: [{ box: [x0,y0,z0,x1,y1,z1] }] or {x0..z1})? -> id | null. Pure.
 * `surfaceY` (the walk's feet there, wholemap-s1 item 2): a zone whose box top is ZONE_UNDER or more below it is UNDER the walk
 * and is not hit (the trial chambers stop at y 31 under grass at 66: the owner's protection is against tunnelling in, which
 * protectzone.mjs guards unchanged, not against walking over the grass). No `surfaceY`: every zone, at any height.
 */
export function zoneHit (zones = [], x, z, margin = ZONE_MARGIN, { surfaceY = null } = {}) {
  for (const q of zones ?? []) {
    const b = Array.isArray(q?.box) ? q.box : [q?.x0, q?.y0, q?.z0, q?.x1, q?.y1, q?.z1]
    if (!b.every(Number.isFinite)) continue
    if (Number.isFinite(surfaceY) && b[4] <= surfaceY - ZONE_UNDER) continue
    if (x >= b[0] - margin && x <= b[3] + margin && z >= b[2] - margin && z <= b[5] + margin) return String(q.id ?? 'zone')
  }
  return null
}

/**
 * THE WAY ROUND A ZONE ON THE SPOKE (wholemap-s1 item 3) -> { waypoints: [[x, z]...], zone, side } | null. Pure. The first zone
 * the bearing's spoke from home meets beyond `from` blocks (within `reach`), at the walk's height `y` (a zone under the walk is
 * no obstacle), is walked round on its box grown by ZONE_MARGIN + DETOUR_PAD: the corners between the spoke's entry and exit,
 * the SHORTER way round (or `side` +1 / -1 when given: the other way, after the shorter one was refused), then the spoke point
 * just past the exit. The legs after it rejoin the spoke.
 */
export function zoneDetour (zones = [], home, bearing, { from = 0, reach = 400, y = null, side = 0 } = {}) {
  const v = bearingVec(bearing)
  let best = null
  for (const q of zones ?? []) {
    const b = Array.isArray(q?.box) ? q.box : [q?.x0, q?.y0, q?.z0, q?.x1, q?.y1, q?.z1]
    if (!b.every(Number.isFinite)) continue
    if (Number.isFinite(y) && b[4] <= y - ZONE_UNDER) continue
    const g = ZONE_MARGIN + DETOUR_PAD
    const [x0, z0, x1, z1] = [b[0] - g, b[2] - g, b[3] + g, b[5] + g]
    // the spoke P(s) = home + v s against the rectangle (slabs)
    let lo = -Infinity, hi = Infinity
    for (const [o, d, a, c] of [[home.x, v.dx, x0, x1], [home.z, v.dz, z0, z1]]) {
      if (Math.abs(d) < 1e-9) { if (o < a || o > c) { lo = Infinity; break } continue }
      const s1 = (a - o) / d, s2 = (c - o) / d
      lo = Math.max(lo, Math.min(s1, s2)); hi = Math.min(hi, Math.max(s1, s2))
    }
    if (!(lo <= hi) || hi <= from || lo > from + reach) continue
    if (!best || lo < best.lo) best = { lo: Math.max(lo, 0), hi, rect: [x0, z0, x1, z1], id: String(q.id ?? 'zone') }
  }
  if (!best) return null
  const [x0, z0, x1, z1] = best.rect
  const w = x1 - x0, h = z1 - z0, per = 2 * (w + h)
  const at = s => ({ x: home.x + v.dx * s, z: home.z + v.dz * s })
  // a boundary point's perimeter coordinate (corner order: (x0,z0) 0, (x1,z0) w, (x1,z1) w+h, (x0,z1) 2w+h)
  const tOf = p => {
    const e = 1e-6
    if (Math.abs(p.z - z0) < e) return p.x - x0
    if (Math.abs(p.x - x1) < e) return w + (p.z - z0)
    if (Math.abs(p.z - z1) < e) return w + h + (x1 - p.x)
    return 2 * w + h + (z1 - p.z)
  }
  const clampR = p => ({ x: Math.min(x1, Math.max(x0, p.x)), z: Math.min(z1, Math.max(z0, p.z)) })
  const E = clampR(at(best.lo)), X = clampR(at(best.hi))
  const tE = tOf(E), tX = tOf(X)
  const corners = [[x0, z0, 0], [x1, z0, w], [x1, z1, w + h], [x0, z1, 2 * w + h]]
  const fwd = ((tX - tE) % per + per) % per
  const dir = side === 1 || side === -1 ? side : (fwd <= per - fwd ? 1 : -1)
  const span = dir === 1 ? fwd : per - fwd
  const pass = corners.map(([cx, cz, t]) => ({ cx, cz, d: dir === 1 ? ((t - tE) % per + per) % per : ((tE - t) % per + per) % per }))
    .filter(c => c.d > 1e-6 && c.d < span - 1e-6).sort((a, b) => a.d - b.d)
  const out = at(best.hi + DETOUR_PAD)
  const waypoints = [...pass.map(c => [Math.round(c.cx), Math.round(c.cz)]), [Math.round(out.x), Math.round(out.z)]]
  return { waypoints, zone: best.id, side: dir, length: Math.round(span) }
}

/**
 * THE STRAIGHT LINE OF A LEG, SAMPLED -> { ok } | { ok: false, why: 'water'|'zone'|'unread'|'drop', at }. Pure. Every `every` blocks from
 * `from` to `to` (x/z), the column's surface is read: a water column is a crossing (no bridging, owner 10-27: the trip turns or
 * bends instead); a protected zone (+ margin) is never entered; an unread column (outside the loaded chunks) is refused.
 */
export function lineClear (read, from, to, { zones = [], every = 3, swim = 0 } = {}) {
  const dx = to.x - from.x, dz = to.z - from.z
  // EXPWATER-01: a swim line is read EVERY block (a crossing's width is counted, not sampled)
  const n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / (swim > 0 ? 1 : every)))
  let y = from.y, wet = 0, run = 0, waterY = null, last = null, bank = null, dryAt = null, exit = null
  for (let i = 1; i <= n; i++) {
    const x = Math.floor(from.x + dx * i / n), z = Math.floor(from.z + dz * i / n)
    if (last && last[0] === x && last[1] === z) continue
    last = [x, z]
    const s = surfaceAt(read, x, z, y)
    // the zone at the walk's height there (wholemap-s1 item 2); an unread column is judged at every height
    const zid = zoneHit(zones, x, z, ZONE_MARGIN, { surfaceY: s && Number.isFinite(s.y) ? s.y : s ? y : null })
    if (zid) return { ok: false, why: 'zone', at: [x, z], zone: zid }
    if (!s) return { ok: false, why: 'unread', at: [x, z] }
    if (s.water) {
      if (!(swim > 0)) return { ok: false, why: 'water', at: [x, z] }
      // a SWIM (expwater-01): only water (lava, a bubble column: never), its surface not a plunge below the bank, the leg's wet
      // columns within `swim` (a wider crossing is refused with its width so far)
      if (s.liquid !== 'water') return { ok: false, why: 'water', at: [x, z], liquid: s.liquid ?? null }
      if (s.y < y - 1 - SWIM_DROP) return { ok: false, why: 'drop', at: [x, z], water_y: s.y }
      // the NEAR bank of each run is a shore too (the way home climbs out onto it): level with the water, like the far one
      if (!run && y - s.y > SWIM_EXIT) return { ok: false, why: 'water', at: [x, z], bank: y - s.y }
      if (!wet) bank = dryAt   // the last dry standable column before the first water: the near shore
      wet++; run++; waterY = s.y
      if (wet > swim) return { ok: false, why: 'water', at: [x, z], wide: wet }
      continue
    }
    // out of the water: the shore must be one a swimmer climbs out onto (feet at most SWIM_EXIT above the water block)
    if (run > 0) {
      if (s.none || s.y <= waterY || s.y - waterY > SWIM_EXIT) return { ok: false, why: 'water', at: [x, z], bank: s.none ? 'none' : s.y - waterY }
      run = 0
      exit = [x, s.y, z]   // the first dry column past the water: the far shore
    }
    // a column with no standable cell (a trunk, a wall: LIVE 17:40Z, every spruce on the line read as "unread") is the
    // pathfinder's to walk round -- only water and zones close a line
    if (s.none && s.obstructed) continue
    if (s.none) return { ok: false, why: 'drop', at: [x, z] }
    y = s.y
    dryAt = [x, s.y, z]
  }
  if (run > 0) return { ok: false, why: 'water', at: last, open: true, wet }   // a line that ends in the water is no leg
  return wet > 0 ? { ok: true, wet, water_y: waterY, bank, exit } : { ok: true }
}

const BENDS = [0, 25, -25, 50, -50]
// EXPWATER-01: a swim looks for the NARROW place, so its bends are finer and a little wider (offline 11-03 on the showcase: bearing
// 3's lake is 17+ wide at 0 and +-25 and 1-9 wide at 15-20 degrees)
const SWIM_BENDS = [0, 15, -15, 25, -25, 35, -35, 50, -50, 65, -65]
// a leg's END cell may lie up to 20 above the bot (a 1:1 hillside over a 20-block leg: offline 11-02, bearing 6 met a 21-block rise
// at 236 that the scan's default 12 read as nowhere to stand); the line samples every 3 blocks keep the default
const TARGET_WINDOW = Object.freeze({ up: 20, down: 20 })
/**
 * THE NEXT OUTBOUND LEG -> { ok, target: {x, y, z}, via: 'marker'|'bearing', bend } | { ok: false, why }. Pure.
 * The ideal point is on the bearing's SPOKE FROM HOME, LEG_STEP past the bot's own distance along it (LIVE showcase 10-31 17:20Z:
 * aimed from the bot, a bot standing west of home on an east bearing read every target as inward and turned at 12 blocks). A known marker within MARKER_REUSE_R of it, further from home
 * than the bot by >= LEG_STEP / 2, is walked to instead (its approach cell: a cell a bot stood on). Otherwise the bearing,
 * then bends of +-25 and +-50 degrees, the first whose line is clear and whose end is a dry standable cell. All refused: the
 * most telling refusal (water before zone before unread).
 */
export function legTarget (read, { pos, home, bearing, step = LEG_STEP, markers = [], zones = [], detour = null, swim = 0, bridges = [] } = {}) {
  const dHome = p => Math.hypot(p.x - home.x, p.z - home.z)
  const here = dHome(pos)
  // A DETOUR IN HAND (wholemap-s1 item 3) is walked first: its waypoints in order, then the spoke again
  if (detour && Array.isArray(detour.waypoints) && detour.waypoints.length) {
    const r = detourLeg(read, { pos, home, step, zones, detour })
    if (r.ok) return r
    if (r.why !== 'detour_done') {
      // this side refused (water, a drop): the other way round, once per detour
      const o = detour.tried === 2 ? null : zoneDetour(zones, home, bearing, { from: Math.max(0, here - step), y: pos.y, side: -detour.side })
      const r2 = o && detourLeg(read, { pos, home, step, zones, detour: { ...o, tried: 2 } })
      if (r2?.ok) return r2
      return { ...r, whys: `${r.whys ?? ''}/other_side_${r2?.why ?? 'none'}` }
    }
  }
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
    if (lineClear(read, pos, t, { zones }).ok) return { ok: true, target: t, via: 'marker', bend: 0, marker: m.at ?? null, detour: null }
  }
  const whys = []
  for (const bend of BENDS) {
    const q = spoke(Math.tan(bend * Math.PI / 180) * step)
    const x = Math.floor(q.x), z = Math.floor(q.z)
    if (dHome({ x, z }) <= here + step / 3) { whys.push('inward'); continue }
    const lc = lineClear(read, pos, { x, z, y: pos.y }, { zones })
    if (!lc.ok) { whys.push(lc.why); continue }
    const s = surfaceAt(read, x, z, pos.y, TARGET_WINDOW)
    if (!s || s.water || s.none) { whys.push(s?.water ? 'water' : s?.none ? 'steep' : 'unread'); continue }
    return { ok: true, target: { x, y: s.y, z }, via: 'bearing', bend, detour: null }
  }
  // BRIDGEPOST-01: NO DRY BEND -- a finished bridge in reach is walked (dry, before any swim)
  if (whys.includes('water') && bridges?.length) {
    const bl = bridgeLeg(read, { pos, home, bridges, zones })
    if (bl) return bl
  }
  // EXPWATER-01: NO DRY BEND -- the same bends again, swimming a narrow crossing (every dry way was tried first)
  if (swim > 0 && whys.includes('water')) {
    const sw = swimLeg(read, { pos, home, here, spoke, step, zones, swim })
    if (sw.ok) return sw
    if (sw.wide) whys.push(`swim_wide:${sw.wide}`)
    else if (sw.why) whys.push(`swim_${sw.why}`)
  }
  // A ZONE ON THE SPOKE: the way round it (the shorter side, then the other), when the bot is not already walking one
  if (whys.includes('zone')) {
    for (const side of [0, 'other']) {
      const d0 = zoneDetour(zones, home, bearing, { from: Math.max(0, here - step), y: pos.y })
      if (!d0) break
      const d = side === 0 ? d0 : zoneDetour(zones, home, bearing, { from: Math.max(0, here - step), y: pos.y, side: -d0.side })
      const r = d && detourLeg(read, { pos, home, step, zones, detour: { ...d, tried: side === 0 ? 1 : 2 } })
      if (r?.ok) return r
      if (r) whys.push(`detour_${r.why}`)
    }
  }
  const why = ['water', 'zone', 'drop', 'unread', 'steep', 'inward'].find(w => whys.includes(w)) ?? 'blocked'
  return { ok: false, why, whys: whys.join('/') }
}

/**
 * EXPWATER-01: A SWIM LEG -> { ok, target, via: 'swim', bend, wet, shore } | { ok: false, why, wide? }. Pure. The bends of legTarget in
 * order, each with water allowed (lineClear `swim`): the end point, pushed on along the same line up to SWIM_REACH further when it is
 * in the water, to the first dry standable cell (the far shore); the narrowest refusal's width is kept for the log. `shore` is the
 * bot's own cell: the near shore's breadcrumb.
 */
export function swimLeg (read, { pos, home, here, spoke, step = LEG_STEP, zones = [], swim = SWIM_MAX } = {}) {
  const dHome = p => Math.hypot(p.x - home.x, p.z - home.z)
  let wide = null, why = null, best = null
  for (const bend of SWIM_BENDS) {
    const q = spoke(Math.tan(bend * Math.PI / 180) * step)
    const ux = q.x - pos.x, uz = q.z - pos.z, L = Math.hypot(ux, uz)
    if (!(L > 0)) continue
    for (let ext = 0; ext <= SWIM_REACH; ext += 2) {
      const x = Math.floor(q.x + ux / L * ext), z = Math.floor(q.z + uz / L * ext)
      if (dHome({ x, z }) <= here + step / 3) break
      const s = surfaceAt(read, x, z, pos.y, TARGET_WINDOW)
      if (!s || s.none) { why ??= s ? 'steep' : 'unread'; break }
      if (s.water) {
        // no far shore within reach: the water's width to here (at least) is the refusal's
        if (ext + 2 > SWIM_REACH) { const o = lineClear(read, pos, { x, z, y: pos.y }, { zones, swim: Infinity }); if (o.why === 'water' && o.wet > 0) wide = Math.min(wide ?? Infinity, o.wet) }
        continue
      }
      const lc = lineClear(read, pos, { x, z, y: pos.y }, { zones, swim })
      if (!lc.ok) { if (lc.wide) wide = Math.min(wide ?? Infinity, lc.wide); else why ??= lc.why; break }
      if (!lc.wet) break   // a dry line here was the dry pass's to find (it refused the end cell): no swim needed, none taken
      if (!standableAt(read, [x, s.y, z])) break   // the far shore is a cell a bot stands on, dry (Claude review r1)
      // ...and the target is SHORE_INLAND past the far shore's first dry column (Codex review r1 BLOCKER 1: goto's range 2 may stop a
      // bot in the water beside it): along the same line, dry, standable, no more water; a strip narrower than that is no landing. Near
      // the shore, not at the leg's end, so the two shore crumbs are one swim apart
      const ex = lc.exit ?? [x, s.y, z], vx = x - pos.x, vz = z - pos.z, vl = Math.hypot(vx, vz) || 1
      const ix = Math.floor(ex[0] + 0.5 + vx / vl * SHORE_INLAND), iz = Math.floor(ex[2] + 0.5 + vz / vl * SHORE_INLAND)
      const si = surfaceAt(read, ix, iz, s.y, TARGET_WINDOW)
      if (!si || si.water || si.none || !standableAt(read, [ix, si.y, iz])) { why ??= 'shore_narrow'; continue }   // a bar between two runs: on, past the next
      // the shore's own stretch is dry (read from the far shore, so no resampling of the swim changes its count)
      const li = lineClear(read, { x: ex[0], y: ex[1], z: ex[2] }, { x: ix, z: iz, y: ex[1] }, { zones, every: 1 })
      if (!li.ok) { why ??= 'shore_narrow'; continue }
      // the NARROWEST crossing of all the bends is taken (ties: the bend order, straight first)
      if (!best || lc.wet < best.lc.wet) best = { bend, lc, target: { x: ix, y: si.y, z: iz } }
      break
    }
  }
  if (!best) return { ok: false, why: wide != null ? 'water' : (why ?? 'water'), wide }
  // the water starts well ahead: walk DRY to its near shore first (the crossing leg then starts there, and its two crumbs are the two
  // shores, one swim apart)
  const b = best.lc.bank
  if (b && Math.hypot(b[0] - pos.x, b[2] - pos.z) > SHORE_NEAR && dHome({ x: b[0], z: b[2] }) >= here - SHORE_BACK && standableAt(read, b)) {
    return { ok: true, target: { x: b[0], y: b[1], z: b[2] }, via: 'shore', bend: best.bend, wet: 0, detour: null }
  }
  return { ok: true, target: best.target, via: 'swim', bend: best.bend, wet: best.lc.wet, water_y: best.lc.water_y, detour: null,
    shore: [Math.floor(pos.x), Math.floor(pos.y + 1e-6), Math.floor(pos.z)] }
}

/**
 * ONE LEG OF A DETOUR -> legTarget's answer, with `detour` (the waypoints still ahead; empty: back on the spoke). Pure. Waypoints
 * within DETOUR_ARRIVE are passed; the leg goes toward the next one, at most `step` (or out past the town: TOWN_EXIT + step from
 * home, the first leg of a trip that starts at a zone's edge), then bends of +-25 / +-50 degrees off that line. No outward rule:
 * a detour's later legs may close on home.
 */
const DETOUR_TRIES = [...[0, 25, -25, 50, -50, 75, -75].map(b => [b, 1]), ...[0, 40, -40, 80, -80].map(b => [b, 0.5])]
export function detourLeg (read, { pos, home, step = LEG_STEP, zones = [], detour } = {}) {
  const wps = [...(detour?.waypoints ?? [])]
  while (wps.length && Math.hypot(wps[0][0] - pos.x, wps[0][1] - pos.z) <= DETOUR_ARRIVE) wps.shift()
  const rest = { ...detour, waypoints: wps }
  if (!wps.length) return { ok: false, why: 'detour_done', detour: rest }
  const [wx, wz] = wps[0]
  const dx = wx - pos.x, dz = wz - pos.z, L = Math.hypot(dx, dz)
  const here = Math.hypot(pos.x - home.x, pos.z - home.z)
  const len = Math.min(L, Math.max(step, TOWN_EXIT + step - here))
  const ux = dx / L, uz = dz / L
  const whys = []
  // a detour hugs a zone on one side: wider bends, and a half leg, before it gives up (offline on the showcase terrain, 11-02:
  // bearing 0's edge walk past the east village met hills and trees that a 20-block leg at +-50 could not step round)
  for (const [bend, f] of DETOUR_TRIES) {
    const a = bend * Math.PI / 180
    const bx = ux * Math.cos(a) - uz * Math.sin(a), bz = ux * Math.sin(a) + uz * Math.cos(a)
    const x = Math.floor(pos.x + bx * len * f), z = Math.floor(pos.z + bz * len * f)
    // every detour leg closes on its waypoint (a wide bend that only slides along a shore would zigzag there for ever)
    if (L - Math.hypot(wx - x, wz - z) < Math.max(2, 0.1 * len * f)) { whys.push('no_progress'); continue }
    const lc = lineClear(read, pos, { x, z, y: pos.y }, { zones })
    if (!lc.ok) { whys.push(lc.why); continue }
    const s = surfaceAt(read, x, z, pos.y, TARGET_WINDOW)
    if (!s || s.water || s.none) { whys.push(s?.water ? 'water' : s?.none ? 'steep' : 'unread'); continue }
    return { ok: true, target: { x, y: s.y, z }, via: 'detour', bend, detour: rest }
  }
  const why = ['water', 'zone', 'drop', 'unread', 'steep'].find(w => whys.includes(w)) ?? 'blocked'
  return { ok: false, why, whys: whys.join('/'), detour: rest }
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
export function crumbDue (crumbs = [], cell, read = null, { shore = false } = {}) {
  if (read && !standableAt(read, cell)) return false
  const last = crumbs[crumbs.length - 1]
  if (!last) return true
  // EXPWATER-01: a crossing's shores are both kept (the way home swims from the one to the other), however close the last crumb
  if (shore) return !(last[0] === cell[0] && last[1] === cell[1] && last[2] === cell[2])
  return Math.hypot(cell[0] - last[0], cell[2] - last[2]) >= CRUMB_MIN
}

/**
 * THE NEXT HOP HOME -> crumb index | -1. Pure. The crumbs are in outbound order (0 nearest town). From the bot, the LOWEST index
 * below `cursor` whose crumb is within CRUMB_HOP_MAX (x/z) and loaded (`loaded(cell)`), so a meander is cut short; none in
 * reach: the crumb just below the cursor (the adjacent one on the walked route), if loaded. `skip` holds indices whose hop failed.
 */
export function nextCrumb (crumbs = [], pos, cursor = crumbs.length, { loaded = () => true, skip = new Set(), gates = [] } = {}) {
  const top = Math.min(cursor, crumbs.length)
  // EXPWATER-01: A CROSSING IS A GATE (Codex design 11-03): `gates` are the FAR-shore crumbs' indices (the near shore is the one before).
  // The way home never cuts past one -- a hop that skipped it would cross the water somewhere no swim was checked: beyond a gate the
  // lowest hop is the gate itself, and standing on it the next is its near shore
  let lo = 0
  for (const f of gates ?? []) { if (!Number.isInteger(f)) continue; if (f < top) lo = Math.max(lo, f); else if (f === top) lo = Math.max(lo, f - 1) }
  for (let i = lo; i < top; i++) {
    if (skip.has(i)) continue
    const c = crumbs[i]
    if (Math.hypot(c[0] - pos.x, c[2] - pos.z) <= CRUMB_HOP_MAX && loaded(c)) return i
  }
  for (let i = top - 1; i >= lo; i--) {
    if (skip.has(i)) continue
    return loaded(crumbs[i]) ? i : -1
  }
  return -1
}

/**
 * EXPWATER-01 (Codex review r1 BLOCKER 2): THE CROSSING NOT YET SWUM BACK -> the gate's index | null. Pure. A gate f (a far-shore crumb)
 * is unresolved while the bot has not reached its near shore f - 1 (cursor >= f): the outermost such gate is the one ahead of it. While
 * one is, a DRY bot's way home does not fall through to a marker or the direct walk (either would cross the water where no swim was
 * checked); it retries the crossing, then leaves the trail open for `home` to follow later (TRAIL_TTL_MS; past it, `home` walks direct).
 * A WET bot may take any way out of the water.
 */
export function heldGate (gates = [], cursor = Infinity) {
  let out = null
  for (const f of gates ?? []) if (Number.isInteger(f) && f >= 1 && cursor >= f && (out == null || f > out)) out = f
  return out
}
export const GATE_RETRIES = 2

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
    if (zoneHit(zones, x, z, ZONE_MARGIN, { surfaceY: y })) continue
    const g = read(x, y - 1, z)
    if (!solid(g) || FALLING.test(g?.name ?? '') || /_leaves$/.test(g?.name ?? '') || liquid(g)) continue
    if (![0, 1, 2].every(k => { const b = read(x, y + k, z); return passable(b) && !/(torch|chest)$/.test(b?.name ?? '') })) continue
    if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, c]) => liquid(read(x + a, y, z + c)) || liquid(read(x + a, y - 1, z + c)))) continue
    return [x, y, z]
  }
  return null
}

/**
 * MAY A MARKER'S TORCH GO AT `at`? -> bool. Pure. Not with `ice` (or frosted ice) within ICE_TORCH_R of it, a cube (wholemap-s1
 * item 5): block light above 11 melts ice beside it, and a marker by a frozen lake would cut a hole in the road. Packed and blue
 * ice do not melt. An unread cell in the cube refuses (no torch is better than a hole).
 */
export function torchSafe (read, at, r = ICE_TORCH_R) {
  if (!Array.isArray(at)) return false
  for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) for (let c = -r; c <= r; c++) {
    const q = read(at[0] + a, at[1] + b, at[2] + c)
    if (q == null) return false
    if (/^(ice|frosted_ice)$/.test(q.name ?? '')) return false
  }
  return true
}

/**
 * THE MARKERS AS A RESERVATION (groundskeeper-01 on the showcase, Codex + Claude r1 BLOCKER 11-03): a marker is two cobblestone
 * and a torch, 48+ out -- exactly a bot pillar to the tidy's band survey (tidy.mjs surveyTidy), which would cut it. -> shop.mjs
 * recordZones-shaped zones, one a marker, its column + `m` (the tidy and the land plan's road work keep off them). Pure.
 */
export function markerZones (markers = [], m = 1) {
  return (markers ?? []).filter(q => Array.isArray(q?.at) && q.at.length === 3 && q.at.every(Number.isFinite))
    .map(q => ({ box: [q.at[0] - m, -64, q.at[2] - m, q.at[0] + m, 320, q.at[2] + m], why: 'expedition:marker' }))
}
/** The markers' own blocks ("x,y,z": the two cobblestone and the torch) -- the tidy visit's dig-time guard. Pure. */
export function markerCellKeys (markers = []) {
  return (markers ?? []).filter(q => Array.isArray(q?.at) && q.at.length === 3 && q.at.every(Number.isFinite))
    .flatMap(q => [0, 1, 2].map(dy => `${q.at[0]},${q.at[1] + dy},${q.at[2]}`))
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

/**
 * EXPWATER-01: THE GATHER'S SPARE TIME at the turn -> ms. Pure. A one-call trip keeps its whole way back (20 s, or 1.2 x the walk
 * out); a MULTI-CALL trip's way home may finish next call (`home` follows its trail), so it keeps only MULTI_HOME_MS of the call --
 * LIVE 11-03: every multi-call trip's spare was negative by construction (out 0.6 of the call, back 1.2 x that), 0 of 35 trips gathered.
 */
export const MULTI_HOME_MS = 20_000
export function gatherSpare ({ deadline = 0, now = 0, outTook = 0, multi = false } = {}) {
  return deadline - now - (multi ? MULTI_HOME_MS : Math.max(20_000, outTook * 1.2))
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
  return `trip=${t.id ?? '-'} bearing=${t.bearing ?? '-'}${t.mode ? ` aim=${Number(t.aim ?? t.bearing).toFixed(2)} mode=${t.mode}` : ''} ring=${t.ring ?? '-'} dist=${Math.round(t.dist ?? 0)} reason=${t.reason ?? '-'} returned=${t.returned ? 1 : 0} via=${t.via ?? '-'} crumbs=${t.crumbs ?? 0} markers=${t.markers ?? 0} reused=${t.reused ?? 0} cross=${t.crossings ?? 0}${t.bridge ? ` br=${t.bridgeStop ?? 'go'}:${t.bridgePlaced ?? 0}` : ''} deposited=${t.deposited ?? 0} ms=${t.ms ?? 0} haul=${haul}`.slice(0, 295)
}

// ---- BRIDGEPOST-01: bridges (bridge.mjs builds them; these let the planner site and use them) -------------------------------------

/**
 * HOW FAR THE TRIP'S OWN PLANNER GETS PAST A BRIDGE'S LANDING -> blocks of distance from home gained (0..). Pure. From `span.land`,
 * up to `legs` legTarget legs on the bearing (swims allowed as the trip would): the distance of the furthest leg end from home less
 * the landing's. bridge.mjs bridgeSite keeps only spans that open at least BEYOND_MIN.
 */
export function beyondGain (read, span, { home, bearing, zones = [], swim = 0, legs = 3 } = {}) {
  let pos = { x: span.land[0] + 0.5, y: span.land[1], z: span.land[2] + 0.5 }
  const d0 = Math.hypot(pos.x - home.x, pos.z - home.z)
  let best = d0, detour = null
  for (let i = 0; i < legs; i++) {
    const lt = legTarget(read, { pos, home, bearing, zones, detour, swim })
    if (!lt.ok) break
    detour = lt.detour?.waypoints?.length ? lt.detour : null
    pos = { x: lt.target.x + 0.5, y: lt.target.y, z: lt.target.z + 0.5 }
    best = Math.max(best, Math.hypot(pos.x - home.x, pos.z - home.z))
  }
  return Math.round(best - d0)
}

/**
 * A FINISHED BRIDGE AS THE NEXT LEG -> legTarget's answer (via 'bridge_in' | 'bridge') | null. Pure. A bridge whose near end lies
 * within BRIDGE_USE_R of the bot and whose landing is further from home than the bot: standing at its near end (within 2), the leg is
 * along the deck to the landing (`shore`: the near end, a crumb; the landing's crumb becomes a gate as a swim's far shore does);
 * further off, a dry leg to the near end first. The nearest such bridge wins.
 */
export const BRIDGE_USE_R = 28
export const BRIDGE_ON = 3.5                    // the bot is AT a bridge's near end within this (x/z, to its centre)
export const BRIDGE_BACK = 24                   // a bridge's near end may lie this much nearer home than the bot
export function bridgeLeg (read, { pos, home, bridges = [], zones = [] } = {}) {
  const dHome = p => Math.hypot(p[0] - home.x, p[2] - home.z)
  const here = Math.hypot(pos.x - home.x, pos.z - home.z)
  // a bridge that goes OUT (its landing further from home than its near end), whose near end is in reach and not a long way back
  // toward home (a site lies within bridge.mjs SITE_R of the turn, often across it: offline b3, the near end 19 east of the turn)
  const c = (bridges ?? []).filter(b => Array.isArray(b?.near) && Array.isArray(b?.land) && dHome(b.land) > dHome(b.near) + 2 &&
    dHome(b.near) >= here - BRIDGE_BACK && Math.hypot(b.near[0] + 0.5 - pos.x, b.near[2] + 0.5 - pos.z) <= BRIDGE_USE_R &&
    // ...and the bot is on its NEAR side: nearer its near end than its landing (offline: a bot just over a bridge took it back)
    Math.hypot(b.near[0] + 0.5 - pos.x, b.near[2] + 0.5 - pos.z) < Math.hypot(b.land[0] + 0.5 - pos.x, b.land[2] + 0.5 - pos.z))
    .sort((a, b) => Math.hypot(a.near[0] - pos.x, a.near[2] - pos.z) - Math.hypot(b.near[0] - pos.x, b.near[2] - pos.z))
  for (const b of c) {
    const dn = Math.hypot(b.near[0] + 0.5 - pos.x, b.near[2] + 0.5 - pos.z)
    // at the near end: within goto's own arrival (range 2 to the block, so up to ~2.4 from its centre; both reviews r1 BLOCKER: a bot
    // stopped 2.1 out read `bridge_in` again, moved 0, and turned 'blocked' at the bridge)
    if (dn <= BRIDGE_ON) {
      // the deck must still be standable at both ends (a bridge the world no longer has is not walked)
      if (!standableAt(read, b.far) || !standableAt(read, b.land)) continue
      return { ok: true, target: { x: b.land[0], y: b.land[1], z: b.land[2] }, via: 'bridge', bend: 0, wet: 0, bridge: b.id ?? null, detour: null,
        shore: [b.near[0], b.near[1], b.near[2]] }
    }
    if (!standableAt(read, b.near)) continue
    if (!lineClear(read, pos, { x: b.near[0], y: b.near[1], z: b.near[2] }, { zones }).ok) continue
    return { ok: true, target: { x: b.near[0], y: b.near[1], z: b.near[2] }, via: 'bridge_in', bend: 0, wet: 0, bridge: b.id ?? null, detour: null }
  }
  return null
}
