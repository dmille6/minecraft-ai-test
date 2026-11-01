// THE DEEP MINER (deepminer-01; OWNER 11-01 item 2: "a deep miner job ... toward iron/diamond depth"; owner 10-23 M7-M10, O6,
// O7, O11, O13; design docs/reports/deepminer-2026-11-01.md).
//
// WHAT IT IS: a town JOB, not a model choice. One bot per town at a time (the town's `deepmine` lease, DEEPMINE_SLOTS = 1 for the
// first canary: owner O13 single occupancy) walks DOWN THE FINISHED TOWN STAIR (shaft-02) to its y=16 landing, then
//   - IRON trip (no iron pickaxe yet): mines iron at the landing's depth (y 8..23 is the iron peak in the fleet's own worlds:
//     region scan 11-01, board-a/hive-c/placebo-d, 17x17 chunks round home);
//   - DIAMOND trip (an iron pickaxe and the uses for the descent): `mine` on down from the stub end to feet y=-53 (owner O6;
//     deepslate_diamond_ore peaks y -59..-49 in the same scan, and lava lakes start at y<=-55, so -53 keeps a block of floor over
//     the lava level), then works there;
// at depth it works a BRANCH LAYOUT: the known ore in reach first (gather's tunnel: its planner, break veto, lava guard and pickaxe
// budget, oretunnel.mjs), else a straight 2-high branch along a bearing (this module plans every cell: PROBE AHEAD -- a cell is
// never opened beside lava, water or under a falling block; SEAL -- a liquid that reaches an opened cell is filled with a block;
// a torch every 8 cells when the bag has one), and it MARKS THE WAY BACK: a trail of stands, walked back in reverse to the stub,
// then up the stair a step at a time. At town it banks (town_deposit) and turns 3 diamonds into a diamond pickaxe (owner M10).
//
// THE CONTROL: every skill is cut at 180 s (runner.mjs), so the trip is a STATE MACHINE on the bot (bot.deepTrip), advanced by
// one `deep_mine` call per decision while the trip is open (cognitive.mjs issues it ahead of the model and the milestone order):
//   descend -> (deepen) -> work -> return -> bank -> closed.
// Every phase is bounded; a trip past TRIP_MAX_MS or CALLS_MAX goes to `return`; a return that cannot make progress
// RETURN_TRIES times ABANDONS the trip (lease released, `_deepmine end=stranded`): the bot is then exactly where any deep bot is
// today (the exit contract, surface, the stranded ladder) -- owner O11's accepted residual.
//
// EXIT CREDIT (owner O7: "stair credit in the exit contract only for deep-miner leaseholders"): below the stair a leaseholder's
// climb is priced from the stair's bottom landing, not from sea level (`mine`'s canContinueDescent seaLevel), because the stair
// and its own trail are walkable. Everyone else keeps today's contract.
//
// NOT IN THIS SLICE (design section 9): water buckets on lava (owner 11-01 allows it) and obsidian for the enchanting table --
// deepminer-02. KILL SWITCH: DEEPMINE=off (or DEEPMINE_POOLS not naming the pool) -- no order, no trip, no credit.
// Pure except the switch: no bot, no world. The effects live in skills.mjs (deepMine).

import { isWet, isLava, isFalling, isOpen, isFull, planOf, standOf, isStairRecord, LINING_ITEMS } from './shaftgeom.mjs'

// ---- the switch ---------------------------------------------------------------------------------------------------------------
export function deepMineOn (env = process.env, pool = '') {
  const v = String(env?.DEEPMINE ?? '').trim().toLowerCase()
  if (v === 'off' || v === '0' || v === 'false' || v === 'no') return false
  if (v === 'on' || v === '1' || v === 'true') return true
  const pools = String(env?.DEEPMINE_POOLS ?? '*').split(',').map(q => q.trim()).filter(Boolean)
  return pools.includes('*') || pools.includes(String(pool))
}
const slotsOf = env => { const n = Number(env?.DEEPMINE_SLOTS); return Number.isInteger(n) && n >= 1 && n <= 2 ? n : 1 }
export const DEEPMINE = Object.freeze({
  on: deepMineOn(typeof process !== 'undefined' ? process.env : {}, typeof process !== 'undefined' ? (process.env.MEMORY_POOL ?? '') : ''),
  slots: slotsOf(typeof process !== 'undefined' ? process.env : {}),   // owner M8 allows 2; O13: 1 for the first diamond canary
})
export const DEEPMINE_PLOT = 'deepmine'      // the lease key's plot: project-<home>.deepmine.slot<k>

// ---- the numbers ----------------------------------------------------------------------------------------------------------------
export const IRON_FEET = 16                  // the stair's bottom landing (shaftgeom STAIR_BOTTOM_FEET)
export const DEEP_FEET = -53                 // owner O6: branches at feet y=-53
export const DEEP_OK = DEEP_FEET + 6         // a descent that stops at or below this works there (diamond ore is common from -48 down)
export const TRIP_MAX_MS = 40 * 60_000       // a trip older than this goes home
export const WORK_MS = 25 * 60_000           // work phase budget from arrival at depth
export const CALLS_MAX = 40                  // deep_mine calls in one trip (a loop guard: the phases end long before)
export const LEASE_TTL_MS = 8 * 60_000       // renewed by every call (a call is <= 180 s; a gap between calls is seconds)
export const COOLDOWN_MS = 20 * 60_000       // after a trip, this bot does not start another for this long
export const FAIL_BACKOFF_MS = 60 * 60_000   // after a trip that brought nothing back (or was abandoned)
export const PREFER_MS = 30 * 60_000         // SOFT PREFERENCE (owner C13): the town's last miner has the job first for this long
export const MIN_FREE = 8                    // free bag slots to start
export const RETURN_FREE = 2                 // go home at this many free slots
export const SEAL_MIN = 24                   // seal / step blocks in the bag to start (LINING_ITEMS)
export const RETURN_SEAL = 6                 // go home below this many
export const HEALTH_MIN = 16                 // to start
export const RETURN_HEALTH = 10              // go home below this
export const IRON_TRIP_USES = 70             // total pickaxe uses for an iron trip (tunnels ~20-40, the stair's repairs, a reserve)
export const DIAMOND_DESCENT_USES = 120       // uses of pickaxes BELOW iron for the stair down 69 blocks (~1.7/step) + reserve
export const IRON_PICK_MIN = 40              // an iron (or better) pickaxe with at least this many uses: the diamonds need it
export const RETURN_USES = 15                // go home when the bag's pickaxes have this few uses left in all
export const RETURN_IRON_USES = 5            // a diamond trip goes home when its iron pickaxe is spent
export const BRANCH_LEN = 12                 // cells of one branch
export const BRANCHES_MAX = 6                // branches a trip digs
export const MISSES_MAX = 4                  // work rounds in a row with no ore -> go home
export const TORCH_EVERY = 8                 // a torch every 8 branch cells (never required)
export const TRAIL_GAP = 2                   // a trail stand at least this far (Chebyshev) from the last
export const TRAIL_MAX = 400
export const RETURN_TRIES = 3                // return calls without progress before the trip is abandoned
export const DIAMOND_GOAL = 8                // a diamond trip goes home with this many diamonds
export const IRON_GOAL = 24                  // an iron trip goes home with this much raw iron
export const PICK_DIAMONDS = 3               // diamond_pickaxe = 3 diamonds + 2 sticks
export const DIAMOND_KINDS = Object.freeze(['diamond_ore', 'deepslate_diamond_ore'])
export const IRON_ORE_KINDS = Object.freeze(['iron_ore', 'deepslate_iron_ore'])

// ---- the bag ----------------------------------------------------------------------------------------------------------------------
const usesLeft = it => Math.max(0, (Number(it?.maxDurability) || 0) - (Number(it?.durabilityUsed) || 0))
const IRON_TIER = /^(iron|diamond|netherite)_pickaxe$/
/**
 * WHAT THE BAG CAN PAY FOR -> { uses, lowUses, ironUses, seal, free, diamonds, rawIron, torches }. Pure over `items` (mineflayer
 * items: name, count, maxDurability, durabilityUsed) and `slots` (36). `lowUses` = pickaxes below iron tier (toolfor.mjs spends
 * the cheapest eligible tool, so stone and deepslate take these first and the iron one is kept for the diamond ore).
 */
export function tripKit (items = [], slots = 36) {
  let uses = 0, lowUses = 0, ironUses = 0, seal = 0, diamonds = 0, rawIron = 0, torches = 0, n = 0
  for (const it of items) {
    if (!it) continue
    n++
    const name = String(it.name ?? '')
    if (/_pickaxe$/.test(name)) {
      const u = usesLeft(it)
      uses += u
      if (IRON_TIER.test(name)) ironUses = Math.max(ironUses, u)
      else lowUses += u
    }
    if (LINING_ITEMS.includes(name)) seal += it.count ?? 1
    if (name === 'diamond') diamonds += it.count ?? 1
    if (name === 'raw_iron') rawIron += it.count ?? 1
    if (name === 'torch') torches += it.count ?? 1
  }
  return { uses, lowUses, ironUses, seal, free: Math.max(0, slots - n), diamonds, rawIron, torches }
}
/** WHICH TRIP THIS BAG PAYS FOR -> 'diamond' | 'iron' | null. Pure. */
export function tripTarget (kit) {
  if (!kit) return null
  if (kit.ironUses >= IRON_PICK_MIN && kit.lowUses + Math.max(0, kit.ironUses - IRON_PICK_MIN) >= DIAMOND_DESCENT_USES) return 'diamond'
  if (kit.uses >= IRON_TRIP_USES) return 'iron'
  return null
}

// ---- the order ------------------------------------------------------------------------------------------------------------------
/**
 * SHOULD THIS BOT START A TRIP NOW? -> { order: { skill: 'deep_mine', args, why } | null, skip }. Pure. Readings (lazy where they
 * cost a read): on, now, holds (a milestone step waits), atStairTop (on the town's surface within reach of the stair), stair
 * ({ usable: the record is complete with the IRON_FEET landing built }), kit (tripKit), health, state ({ cooldownUntil }), lease
 * -> { free, last, releasedAt } (the town's deepmine lease: free = no live holder; last = the last holder's name).
 */
export function deepMineOrder ({ on = DEEPMINE.on, now = Date.now(), holds = false, atStairTop = false, stair = null, kit = null,
  health = 20, state = {}, me = '', lease = () => ({ free: true, last: null, releasedAt: null }) } = {}) {
  const no = skip => ({ order: null, skip })
  if (!on) return no('off')
  if (holds) return no('milestone')
  if (now < (state.cooldownUntil ?? 0)) return no('cooldown')
  if (!stair?.usable) return no(stair?.why ?? 'no_stair')
  if (!atStairTop) return no('not_at_stair')
  if ((health ?? 20) < HEALTH_MIN) return no('health')
  if (!kit) return no('bag')
  if (kit.free < MIN_FREE) return no('room')
  if (kit.seal < SEAL_MIN) return no('seal_blocks')
  const target = tripTarget(kit)
  if (!target) return no('pickaxe')
  const l = typeof lease === 'function' ? lease() : lease
  if (!l?.free) return no('lease_busy')
  // THE SOFT PREFERENCE (owner C13 "flexible jobs with a soft preference"): the town's last miner may take the job at once; anyone
  // else waits until it has not come back for it within PREFER_MS of its release
  if (l.last && l.last !== me && Number.isFinite(l.releasedAt) && now - l.releasedAt < PREFER_MS) return no('preferred_other')
  return { order: { skill: 'deep_mine', args: { target }, why: `town deep miner: ${target} trip down the town stair (${kit.uses} pickaxe uses, ${kit.seal} blocks, ${kit.free} free slots)` }, skip: null }
}
/** AN OPEN TRIP'S NEXT CALL -> { skill, args, why } | null (no trip, or it is closed). Pure. */
export function deepTripOrder (trip) {
  if (!trip || trip.phase === 'closed') return null
  return { skill: 'deep_mine', args: { trip: trip.id }, why: `town deep miner: ${trip.target} trip, ${trip.phase}` }
}

// ---- the trip -------------------------------------------------------------------------------------------------------------------
export const PHASES = Object.freeze(['descend', 'deepen', 'work', 'return', 'bank', 'closed'])
export function newTrip ({ id, target, now = Date.now(), landing = IRON_FEET, slot = 1, gen = null, from = null } = {}) {
  return { id, target, phase: 'descend', startedAt: now, landing, slot, gen, trail: [], calls: 0, branches: 0, misses: 0, found: 0,
    arrivedAt: null, returnTries: 0, deepenTries: 0, bearing: 0, from, cells: 0, sealed: 0, torches: 0, end: null }
}
/**
 * WHY GO HOME NOW -> reason | null. Pure. The phase decides only after arrival at depth (work); the trip's clocks and the bag decide.
 */
export function returnWhy (trip, { now = Date.now(), kit = null, health = 20 } = {}) {
  if (!trip) return null
  if (now - trip.startedAt > TRIP_MAX_MS) return 'trip_time'
  if ((trip.calls ?? 0) >= CALLS_MAX) return 'calls'
  if ((health ?? 20) < RETURN_HEALTH) return 'health'
  if (kit) {
    if (kit.free <= RETURN_FREE) return 'bag_full'
    if (kit.uses <= RETURN_USES) return 'pickaxe'
    if (trip.target === 'diamond' && kit.ironUses < RETURN_IRON_USES) return 'iron_pickaxe'
    if (kit.seal < RETURN_SEAL) return 'seal_blocks'
    if (trip.target === 'diamond' && kit.diamonds - (trip.diamonds0 ?? 0) >= DIAMOND_GOAL) return 'goal'
    if (trip.target === 'iron' && kit.rawIron - (trip.rawIron0 ?? 0) >= IRON_GOAL) return 'goal'
  }
  if (trip.arrivedAt != null && now - trip.arrivedAt > WORK_MS) return 'work_time'
  if ((trip.misses ?? 0) >= MISSES_MAX) return 'no_ore'
  if ((trip.branches ?? 0) >= BRANCHES_MAX && (trip.misses ?? 0) > 0) return 'branches'
  return null
}
/** The ore kinds this trip works at this depth. Pure: diamonds only below y=0 (they barely generate above: scan 11-01). */
export function workKinds (trip, y) {
  if (trip?.target === 'diamond' && Number.isFinite(y) && y < 0) return [...DIAMOND_KINDS, ...IRON_ORE_KINDS]
  return [...IRON_ORE_KINDS]
}

// ---- the trail (the way back) ---------------------------------------------------------------------------------------------------
const cheb = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]))
/** Add a stand to the trail -> a new trail. Pure. Kept when TRAIL_GAP or more from the last stand; capped (oldest kept). */
export function trailPush (trail = [], cell, gap = TRAIL_GAP) {
  if (!Array.isArray(cell) || cell.length !== 3 || !cell.every(Number.isFinite)) return trail
  const last = trail[trail.length - 1]
  if (last && cheb(last, cell) < gap) return trail
  if (trail.length >= TRAIL_MAX) return trail
  return [...trail, cell.map(Math.floor)]
}
/**
 * THE WAY BACK FROM HERE -> the stands to walk, nearest-first back to the trail's start. Pure. The trail point nearest the bot
 * (within `near`) is the entry; every point after it is the bot's own later wandering and is skipped. [] when the bot is off it.
 */
export function trailBack (trail = [], feet, near = 12) {
  if (!trail.length || !Array.isArray(feet)) return []
  let best = -1, bd = Infinity
  for (let i = 0; i < trail.length; i++) { const d = cheb(trail[i], feet); if (d <= bd) { bd = d; best = i } }
  if (best < 0 || bd > near) return []
  return trail.slice(0, best + 1).reverse()
}

// ---- the stair route ------------------------------------------------------------------------------------------------------------
/**
 * THE STAIR'S STANDS, top down, to a landing's stub end -> [[x,y,z]] | null. Pure. Step 0's stand (the ground cell over its tread)
 * through the landing step's, then the stub's floor cells outward. A route walked a hop at a time: each hop is one stair move.
 */
export function stairRoute (rec, feet = IRON_FEET) {
  if (!isStairRecord(rec)) return null
  const plan = planOf(rec)
  const l = plan.landings.find(q => q.feet === feet)
  if (!l) return null
  const out = []
  for (let k = 0; k <= l.k; k++) out.push(standOf(plan, k))
  for (const c of l.stub) if (c[1] === feet) out.push(c)
  return out
}
/** The index on a route nearest these feet (within 2), or -1. Pure. */
export function routeIndex (route = [], feet) {
  let best = -1, bd = Infinity
  for (let i = 0; i < route.length; i++) { const d = cheb(route[i], feet); if (d < bd) { bd = d; best = i } }
  return bd <= 2 ? best : -1
}

// ---- the branch -------------------------------------------------------------------------------------------------------------------
export const BEARINGS = Object.freeze([[1, 0], [0, 1], [-1, 0], [0, -1]])
const N6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
const add = (c, d) => [c[0] + d[0], c[1] + d[1], c[2] + d[2]]
/**
 * A BRANCH'S CELLS -> [{ feet: [x,y,z], head: [x,y,z+1 up] }] from the cell beyond `start` along bearing b (0..3), `len` long. Pure.
 */
export function branchCells (start, b, len = BRANCH_LEN) {
  const [dx, dz] = BEARINGS[((b % 4) + 4) % 4]
  const out = []
  for (let i = 1; i <= len; i++) { const f = [start[0] + dx * i, start[1], start[2] + dz * i]; out.push({ feet: f, head: [f[0], f[1] + 1, f[2]] }) }
  return out
}
/**
 * PROBE AHEAD: may this cell be opened? -> null (yes) | 'lava' | 'water' | 'falling' | 'unknown' | 'void'. Pure over read(x,y,z)
 * -> { name, boundingBox } | null. The cell itself, its six neighbours (lava/water next to an opened cell flows in), the cell over a
 * head cell (a falling block drops in), and for a feet cell the floor under it (a hole or a liquid under the next step: never
 * walked onto). `open` = keys "x,y,z" of cells this branch has already opened (never counted as hazards).
 */
export function probeCell (read, c, { feet = false, open = new Set() } = {}) {
  const b = read(...c)
  if (!b) return 'unknown'
  if (isLava(b)) return 'lava'
  if (isWet(b)) return 'water'
  for (const d of N6) {
    const n = add(c, d)
    if (open.has(n.join(','))) continue
    const q = read(...n)
    if (!q) return 'unknown'
    if (isLava(q)) return 'lava'
    if (isWet(q)) return 'water'
    if (d[1] === 1 && isFalling(q)) return 'falling'
  }
  if (feet) {
    const fl = read(c[0], c[1] - 1, c[2])
    if (!fl) return 'unknown'
    if (!isFull(fl)) return 'void'
  }
  return null
}
/**
 * THE NEXT BRANCH MOVE -> { op: 'dig', at } | { op: 'step', to, i } | { op: 'stop', why, i }. Pure. Cell i of `cells` (branchCells):
 * probe both cells first (an unsafe one ends the branch BEFORE it is opened), then dig the head cell, then the feet cell, then step.
 * A cell already open (a cave) is fine to walk when its probe passes.
 */
export function branchNext (read, cells, i, open = new Set()) {
  if (i >= cells.length) return { op: 'stop', why: 'end', i }
  const { feet, head } = cells[i]
  const hz = probeCell(read, head, { open }) ?? probeCell(read, feet, { feet: true, open })
  if (hz) return { op: 'stop', why: hz, i }
  for (const c of [head, feet]) { const b = read(...c); if (b && !isOpen(b)) return { op: 'dig', at: c } }
  return { op: 'step', to: feet, i }
}
/**
 * SEAL: the liquid cells beside the cells the bot has opened (its stand and the branch so far) -> [[x,y,z]]. Pure. A liquid that
 * reaches an opened cell (a flow from a cave the probe could not see past) is filled with a block: lava becomes stone-like,
 * water stops. Nothing else is placed.
 */
export function sealTargets (read, opened = []) {
  const keys = new Set(opened.map(c => c.join(',')))
  const out = new Map()
  for (const c of opened) for (const d of N6) {
    const n = add(c, d), k = n.join(',')
    if (keys.has(k) || out.has(k)) continue
    const q = read(...n)
    if (q && (isLava(q) || isWet(q)) && !/kelp|seagrass/.test(String(q.name))) out.set(k, n)
  }
  return [...out.values()]
}

// ---- rows -----------------------------------------------------------------------------------------------------------------------
/** The `_deepmine` row's detail (the read's defect lines key on op= and end=). Pure. */
export function deepRowDetail ({ op = '-', phase = '-', target = '-', why = '-', y = '-', trip = '-', found = '-', n = '-', ms = '-', end = '-' } = {}) {
  return `op=${op} phase=${phase} target=${target} why=${why} y=${y} trip=${trip} found=${found} n=${n} ms=${ms} end=${end}`.slice(0, 300)
}
export function deepModeDetail () {
  return `on=${DEEPMINE.on ? 1 : 0} slots=${DEEPMINE.slots} feet=${IRON_FEET}/${DEEP_FEET} trip_min=${TRIP_MAX_MS / 60_000}`
}
