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
import { BUILD_USES, TOWNMINE } from './townmine.mjs'   // townmine-01

// ---- the switch ---------------------------------------------------------------------------------------------------------------
export function deepMineOn (env = process.env, pool = '') {
  const v = String(env?.DEEPMINE ?? '').trim().toLowerCase()
  if (v === 'off' || v === '0' || v === 'false' || v === 'no') return false
  if (v === 'on' || v === '1' || v === 'true') return true
  const pools = String(env?.DEEPMINE_POOLS ?? '*').split(',').map(q => q.trim()).filter(Boolean)
  return pools.includes('*') || pools.includes(String(pool))
}
// townmine-01 (coordinator 11-09, owner M8): TWO deep miners a town where the town mine is on -- one builds (the mine's build lease,
// MINE_BUILD_PLOT, holds a single builder) while the other mines; DEEPMINE_SLOTS still decides when set
export const slotsOf = (env, mine = false) => { const n = Number(env?.DEEPMINE_SLOTS); return Number.isInteger(n) && n >= 1 && n <= 2 ? n : (mine ? 2 : 1) }
export const DEEPMINE = Object.freeze({
  on: deepMineOn(typeof process !== 'undefined' ? process.env : {}, typeof process !== 'undefined' ? (process.env.MEMORY_POOL ?? '') : ''),
  slots: slotsOf(typeof process !== 'undefined' ? process.env : {}, TOWNMINE.on),   // owner M8 allows 2 (townmine-01: 2 with the mine on); O13: 1 before it
})
export const DEEPMINE_PLOT = 'deepmine'      // the lease key's plot: project-<home>.deepmine.slot<k>
export const MINE_BUILD_PLOT = 'deepminebuild'   // townmine-01: the one build trip a town at a time: project-<home>.deepminebuild.slot1

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
export const DIAMOND_DESCENT_USES = 220       // uses of pickaxes BELOW iron: the stair down 69 blocks took ~200 on Paper 11-01 (3 digs a step), + branches
export const IRON_PICK_MIN = 40              // an iron (or better) pickaxe with at least this many uses: the diamonds need it
export const RETURN_USES = 15                // go home when the bag's pickaxes have this few uses left in all
export const RETURN_IRON_USES = 5            // a diamond trip goes home when its iron pickaxe is spent
export const RETURN_LOW_USES = 10            // ...or when the pickaxes below iron are (Paper 11-01: the iron one then dug deepslate until it broke)
export const BRANCH_LEN = 12                 // cells of one branch
export const BRANCHES_MAX = 6                // branches a trip digs
export const MISSES_MAX = 4                  // work rounds in a row with no ore -> go home
export const TORCH_EVERY = 8                 // a torch every 8 branch cells (never required)
export const TRAIL_GAP = 2                   // a trail stand at least this far (Chebyshev) from the last
export const TRAIL_MAX = 3000                // a 40-min trip at 2 apart never fills it (Claude r1 note: a full trail dropped the late stands)
export const RETURN_TRIES = 3                // return calls without progress before the trip is abandoned
export const DIAMOND_GOAL = 8                // a diamond trip goes home with this many diamonds
export const IRON_GOAL = 24                  // an iron trip goes home with this much raw iron
export const PICK_DIAMONDS = 3               // diamond_pickaxe = 3 diamonds + 2 sticks
export const DIAMOND_KINDS = Object.freeze(['diamond_ore', 'deepslate_diamond_ore'])
export const IRON_ORE_KINDS = Object.freeze(['iron_ore', 'deepslate_iron_ore'])
export const COAL_ORE_KINDS = Object.freeze(['coal_ore', 'deepslate_coal_ore'])   // townmine-01: the owner's "iron, coal and diamonds"

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
/**
 * WHICH TRIP THIS BAG PAYS FOR -> 'build' | 'diamond' | 'iron' | null. Pure. townmine-01: while the town's mine is sited and not
 * finished (`mine` = townmine.mjs mineState: sited, not complete, not stopped), a bag with BUILD_USES and SEAL_MIN blocks builds it
 * first (it is the way down every later trip takes); otherwise as before.
 */
export function tripTarget (kit, mine = null) {
  if (!kit) return null
  if (mine?.sited && !mine.complete && !mine.stopped && kit.uses >= BUILD_USES && kit.seal >= SEAL_MIN) return 'build'
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
  const target = tripTarget(kit, stair?.mine ?? null)
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
export const PHASES = Object.freeze(['descend', 'deepen', 'work', 'build', 'return', 'bank', 'closed'])
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
    if (trip.target === 'diamond' && kit.lowUses <= RETURN_LOW_USES) return 'stone_pickaxes'
    if (kit.seal < RETURN_SEAL) return 'seal_blocks'
    if (trip.target === 'diamond' && kit.diamonds - (trip.diamonds0 ?? 0) >= DIAMOND_GOAL) return 'goal'
    if (trip.target === 'iron' && kit.rawIron - (trip.rawIron0 ?? 0) >= IRON_GOAL) return 'goal'
  }
  // townmine-01: a build trip goes home when the mine is finished (or stopped), never on the ore clocks below
  if (trip.target === 'build') return trip.built ? 'built' : (trip.arrivedAt != null && now - trip.arrivedAt > WORK_MS ? 'work_time' : null)
  // OBSIDIAN-01: a finished cast goes home to bank what it made (the town's table waits on it)
  if (trip.obs?.done && (trip.obs.got ?? 0) > 0) return 'obsidian'
  if (trip.arrivedAt != null && now - trip.arrivedAt > WORK_MS) return 'work_time'
  if ((trip.misses ?? 0) >= MISSES_MAX) return 'no_ore'
  if ((trip.branches ?? 0) >= BRANCHES_MAX && (trip.misses ?? 0) > 0) return 'branches'
  return null
}
/** A RETURN THAT HAS RUN TOO LONG -> bool (Claude r1 note: the return phase had no cap of its own). Pure. */
export function returnOverdue (trip, now = Date.now()) {
  return !!trip && (now - (trip.startedAt ?? 0) > TRIP_MAX_MS + 10 * 60_000 || (trip.calls ?? 0) > 2 * CALLS_MAX)
}
/** The ore kinds this trip works at this depth. Pure: diamonds only below y=0 (they barely generate above: scan 11-01). */
export function workKinds (trip, y) {
  if (trip?.target === 'diamond' && Number.isFinite(y) && y < 0) return [...DIAMOND_KINDS, ...IRON_ORE_KINDS]
  return trip?.coal ? [...IRON_ORE_KINDS, ...COAL_ORE_KINDS] : [...IRON_ORE_KINDS]
}

/**
 * DOES AN OPEN TRIP OWN THE BODY BETWEEN ITS CALLS? -> bool. Pure. Paper 11-01: in the seconds between two deep_mine calls the
 * maroon lattice read a miner in its own stair at y=-33 as "no path can start" and pillared it out of the trip. While a trip is
 * underground (deepen, work, return) and not older than TRIP_MAX_MS + 10 min, its own return is the way out; past that (a trip
 * nobody advances any more) the reflexes own the body again.
 */
export function tripHoldsBody (trip, now = Date.now()) {
  return !!trip && ['deepen', 'work', 'return', 'build'].includes(trip.phase) && now - (trip.startedAt ?? 0) < TRIP_MAX_MS + 10 * 60_000   // townmine-01: a build trip at the frontier too
}
/** The pause before the next decision while a trip is open (the fleet's 20 s cooldown is a gap the reflexes read as idle). */
export const TRIP_NEXT_MS = 1_000

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
  // ties go to the EARLIEST stand (Claude r4 note 2: a branch loop's junction read as further back)
  for (let i = 0; i < trail.length; i++) { const d = cheb(trail[i], feet); if (d < bd) { bd = d; best = i } }
  if (best < 0 || bd > near) return []
  return trail.slice(0, best + 1).reverse()
}

/**
 * THE RETURN'S PROGRESS -> the trail index of the stand nearest the bot (lower = nearer the stub), or Infinity off the trail. Pure.
 * Paper 11-01 (hazard field): a return that walked one stand back and forth beside a refused lava leg never counted as stuck.
 */
export function trailProgress (trail = [], feet, near = 12) {
  const b = trailBack(trail, feet, near)
  return b.length ? b.length - 1 : Infinity
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
/** The rock a branch may dig: generated underground blocks only (never a placed or crafted block). Pure. */
const NATURAL = /^(stone|deepslate|tuff|granite|diorite|andesite|calcite|dirt|coarse_dirt|rooted_dirt|clay|mud|gravel|sand|red_sand|sandstone|red_sandstone|smooth_basalt|dripstone_block|pointed_dripstone|moss_block|moss_carpet|glow_lichen|amethyst_block|budding_amethyst|infested_.*|.*_ore|raw_.*_block|cobweb|sculk|sculk_vein|cave_vines|cave_vines_plant|hanging_roots|spore_blossom|azalea|flowering_azalea|big_dripleaf|big_dripleaf_stem|small_dripleaf|terracotta|.*_terracotta|bedrock)$/
export const isNatural = b => !!b && NATURAL.test(String(b.name ?? '').replace(/\[.*\]$/, '')) && b.name !== 'bedrock'
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
    const q = read(...n)
    // an OPENED cell is read too (Codex r1 B2): one the miner opened that has since flooded is a hazard like any other
    if (open.has(n.join(','))) { if (q && (isLava(q) || isWet(q))) return isLava(q) ? 'lava' : 'water'; continue }
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
  // ONLY THE WORLD'S OWN ROCK IS DUG (Claude r1 B1): a branch never digs a block someone built or placed -- a chest, a table, a
  // wall, a stair's lining -- whatever led the miner there; anything not on the natural list ends the branch
  for (const c of [head, feet]) { const b = read(...c); if (b && !isOpen(b) && !isNatural(b)) return { op: 'stop', why: 'not_natural', i } }
  for (const c of [head, feet]) { const b = read(...c); if (b && !isOpen(b)) return { op: 'dig', at: c } }
  return { op: 'step', to: feet, i }
}
/**
 * SEAL: the liquid cells beside the cells the bot has opened (its stand and the branch so far) -> [[x,y,z]]. Pure. A liquid that
 * reaches an opened cell (a flow from a cave the probe could not see past) is filled with a block: lava becomes stone-like,
 * water stops. Nothing else is placed.
 */
export function sealTargets (read, opened = [], occupied = []) {
  const keys = new Set(opened.map(c => c.join(',')))
  const body = new Set(occupied.map(c => c.join(',')))
  const out = new Map()
  // an OPENED cell that has flooded is filled too (Codex r1 B2), never one the bot stands in
  for (const c of opened) {
    const k = c.join(','), q = read(...c)
    if (!body.has(k) && q && (isLava(q) || isWet(q)) && !/kelp|seagrass/.test(String(q.name))) out.set(k, c)
  }
  for (const c of opened) for (const d of N6) {
    const n = add(c, d), k = n.join(',')
    if (keys.has(k) || out.has(k) || body.has(k)) continue   // never the bot's own cells (Codex r4 B1)
    const q = read(...n)
    if (q && (isLava(q) || isWet(q)) && !/kelp|seagrass/.test(String(q.name))) out.set(k, n)
  }
  return [...out.values()]
}

/**
 * THE LEG'S EXPOSED LIQUID -> [[x,y,z]] to fill, nearest the bot first, at most `max`. Pure. Paper 11-01 (hazard field): the walk
 * guard (lava_corridor) refuses a leg with lava beside it anywhere along the way, not only at the next stand's faces. Every liquid
 * cell in the box round the bot's cells and the next stand's (one block of margin) that touches an OPEN cell of that box is
 * exposed to the walk; never the bot's cells or the stand's own cells (they are walked into).
 */
export function legSealTargets (read, from, to, max = 6, keep = new Set()) {
  if (!Array.isArray(from) || !Array.isArray(to)) return []
  // never the bot's cells, the stand's, the straight line between them (it is walked through), or `keep` (the town stair's cells:
  // a block in a stair air cell reads as blocked to the next descent -- Claude r5 note 1)
  const mid = [Math.round((from[0] + to[0]) / 2), Math.round((from[1] + to[1]) / 2), Math.round((from[2] + to[2]) / 2)]
  const skip = new Set([from, [from[0], from[1] + 1, from[2]], to, [to[0], to[1] + 1, to[2]], mid, [mid[0], mid[1] + 1, mid[2]]].map(c => c.join(',')))
  for (const k of keep) skip.add(k)
  // LAVA within TWO of the leg, buried or not (Paper 11-01 r6: the walk guard -- lavaguard.mjs cellLavaSafe -- reads the cardinal
  // cells of every route sample and the 3 below, rock or no rock, so lava sealed in the wall still refuses the leg); WATER only
  // where it touches an open cell within ONE (water in rock is no hazard to a walk)
  const M = 2
  const x0 = Math.min(from[0], to[0]) - M, x1 = Math.max(from[0], to[0]) + M
  const y0 = Math.min(from[1], to[1]) - 3, y1 = Math.max(from[1], to[1]) + 2
  const z0 = Math.min(from[2], to[2]) - M, z1 = Math.max(from[2], to[2]) + M
  const inner = (x, y, z) => x >= x0 + 1 && x <= x1 - 1 && z >= z0 + 1 && z <= z1 - 1 && y >= y0 + 2
  const out = []
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
    const k = `${x},${y},${z}`
    if (skip.has(k)) continue
    const q = read(x, y, z)
    if (!q || !(isLava(q) || isWet(q)) || /kelp|seagrass/.test(String(q.name))) continue
    if (isLava(q)) { out.push([x, y, z]); continue }
    if (!inner(x, y, z)) continue
    const exposed = N6.some(d => { const n = [x + d[0], y + d[1], z + d[2]]; if (!inner(...n)) return false; const b = read(...n); return !!b && isOpen(b) })
    if (exposed) out.push([x, y, z])
  }
  const d2 = c => (c[0] - from[0]) ** 2 + (c[1] - from[1]) ** 2 + (c[2] - from[2]) ** 2
  return out.sort((a, b) => d2(a) - d2(b)).slice(0, max)
}

// ---- rows -----------------------------------------------------------------------------------------------------------------------
/** The `_deepmine` row's detail (the read's defect lines key on op= and end=). Pure. */
export function deepRowDetail ({ op = '-', phase = '-', target = '-', why = '-', y = '-', trip = '-', found = '-', n = '-', ms = '-', end = '-' } = {}) {
  return `op=${op} phase=${phase} target=${target} why=${why} y=${y} trip=${trip} found=${found} n=${n} ms=${ms} end=${end}`.slice(0, 300)
}
export function deepModeDetail () {
  return `on=${DEEPMINE.on ? 1 : 0} slots=${DEEPMINE.slots} feet=${IRON_FEET}/${DEEP_FEET} trip_min=${TRIP_MAX_MS / 60_000}`
}

// ================================================================================================================================
// OBSIDIAN-01 (owner 11-07 ~13:20Z "Both at once": obsidian for the enchanting table, fleet AND showcase; enchantshop-1104 E2;
// design docs/reports/obsidian-design-2026-11-04.md + its 11-07 revision). A DIAMOND TRIP'S SUB-GOAL, never a trip of its own.
//
// MEASURED 11-07 (showcase region copy, +-150 of home): the 11-04 design's ISOLATED lava source (four sides and floor solid under
// a rock cell) is 5 of 1,734 top-layer lava sources at y -55 (0.3%); with a solid rock hole over it, 6 in 90,000 m2 -- a feature
// with no population. What the deep layer HAS is lava LAKES at -55 under open cave air (998 of 1,734), 237 of them with a dry
// shore a miner at feet -53 can stand on and solid rock behind it for a basin (48 distinct 16x16 areas). So the cast is made in a
// BASIN THE MINER DIGS ITSELF, in rock it has read, with ONE bucket used in turn:
//
//   the tunnel at feet f (-53), d = the bearing toward the lake:   P3  P2  P1  S | C (cave air)
//                                                         f-1:   W   H   rock shore| C1 (cave air)
//                                                         f-2:  rock rock rock rock| Lq (lava source, the lake)
//   1. water into W (from P1: two cells out) -> W a water source, flowing water in H; contained by rock (no spread at f)
//   2. the empty bucket takes ONE lava source from the lake (from S: two below, one ahead; the lake refills it, nothing rises)
//   3. that lava into H (from P1: one out) -> beside W's water it is obsidian the instant it lands (no open lava stands)
//   4. W's water back into the bucket (the same bucket: one bucket per bot is enough), 5. H dug with the diamond pickaxe (75 s
//      on Paper 11-04), 6. the drop picked up by stepping into H and out (1 down, 1 up). Repeat; at the end W and H are filled.
// Any read that is not what the step expects stops the cast where it stands; loose lava anywhere in the site is sealed with a
// block at once (deepmine's SEAL), never walked past. No lava site, no bucket, no water, no diamond pickaxe: the trip simply
// works as a diamond trip (the refusal chain is tested). The water comes from an INFINITE source (two or more source
// neighbours: the fill takes nothing from the world) near the stair top before the descent, or from a water lake at depth by
// the same cave-edge geometry. KILL SWITCH: OBSIDIAN=off (or OBSIDIAN_POOLS not naming the pool). Pure: no bot, no world.
// ================================================================================================================================
export function obsidianOn (env = process.env, pool = '') {
  const v = String(env?.OBSIDIAN ?? '').trim().toLowerCase()
  if (v === 'off' || v === '0' || v === 'false' || v === 'no') return false
  if (v === 'on' || v === '1' || v === 'true') return true
  const pools = String(env?.OBSIDIAN_POOLS ?? '*').split(',').map(q => q.trim()).filter(Boolean)
  return pools.includes('*') || pools.includes(String(pool))
}
export const OBSIDIAN = Object.freeze({
  on: obsidianOn(typeof process !== 'undefined' ? process.env : {}, typeof process !== 'undefined' ? (process.env.MEMORY_POOL ?? '') : ''),
})
export const OBS_GOAL = 4                    // the enchanting table's obsidian (2 diamonds, 4 obsidian, 1 book): the town keeps 4
export const OBS_PICK_USES = 8               // a diamond (or netherite) pickaxe with this many uses: 1 a block, and a margin
export const OBS_SCAN = 24                   // the lake search box round the miner (+-24: one site area per ~1,900 m2 measured)
export const OBS_APPROACH_MAX = 40           // tunnel cells the approach may dig
export const OBS_CYCLES_MAX = 8              // casts a trip tries
export const OBS_FAILS_MAX = 3               // failed steps before the cast is given up for the trip
export const OBS_DIG_MS = 95_000             // a call starts the obsidian dig only with this much of its budget left (75 s measured)
export const OBS_WATER_SCAN = 40             // the water search at the stair top (+-40, +-10 in y)
export const OBS_DEEPEN_TRIES = 3            // extra deepen calls toward feet -53 when the trip stopped above it
export const OBS_FEET = DEEP_FEET            // the cave-edge stand is two over the lake surface (-55 + 2)

const nm = b => String(b?.name ?? '').replace(/\[.*\]$/, '')
const lvlOf = b => { const v = b?.level ?? b?.metadata; return v == null ? NaN : Number(v) }
/** A liquid SOURCE of this kind ('lava' | 'water'): name and level 0 (mineflayer's metadata on a liquid is its level). Pure. */
export const isSourceOf = (b, kind) => !!b && nm(b) === kind && lvlOf(b) === 0
/** Real air (never a plant, a torch or a liquid: the rays and the water must pass it). Pure. */
export const isAir = b => !!b && /^(air|cave_air|void_air)$/.test(nm(b))
const liquid = b => !!b && (isLava(b) || isWet(b))
const fullDry = b => isFull(b) && !liquid(b)

/** WHAT THE BAG HOLDS FOR A CAST -> { pickUses, buckets, water, lava, obsidian, seal }. Pure. */
export function obsKit (items = []) {
  let pickUses = 0, buckets = 0, water = 0, lava = 0, obsidian = 0, seal = 0
  for (const it of items) {
    if (!it) continue
    const n = String(it.name ?? ''), c = it.count ?? 1
    if (/^(diamond|netherite)_pickaxe$/.test(n)) pickUses = Math.max(pickUses, usesLeft(it))
    else if (n === 'bucket') buckets += c
    else if (n === 'water_bucket') water += c
    else if (n === 'lava_bucket') lava += c
    else if (n === 'obsidian') obsidian += c
    if (LINING_ITEMS.includes(n)) seal += c
  }
  return { pickUses, buckets, water, lava, obsidian, seal }
}
/**
 * DOES THIS DIAMOND TRIP TAKE THE OBSIDIAN SUB-GOAL? -> { want, skip }. Pure. `town` = the town index's known obsidian count (null:
 * unreadable -> no sub-goal: the need is never guessed). Every refusal leaves an ordinary diamond trip (a different job, never a
 * wait): no diamond pickaxe (the bank phase makes one from 3 diamonds), no bucket, the town stocked.
 */
export function obsidianWant ({ on = OBSIDIAN.on, target = 'diamond', kit = null, town = null, goal = OBS_GOAL } = {}) {
  const no = skip => ({ want: 0, skip })
  if (!on) return no('off')
  if (target !== 'diamond') return no('iron_trip')
  if (!kit) return no('bag')
  if (!Number.isFinite(town)) return no('town_unknown')
  if (town + (kit.obsidian ?? 0) >= goal) return no('stocked')
  if ((kit.pickUses ?? 0) < OBS_PICK_USES) return no('no_diamond_pickaxe')
  if ((kit.buckets ?? 0) + (kit.water ?? 0) + (kit.lava ?? 0) < 1) return no('no_bucket')
  if ((kit.seal ?? 0) < 8) return no('seal_blocks')
  return { want: goal - town - (kit.obsidian ?? 0), skip: null }
}

const D = b => BEARINGS[((b % 4) + 4) % 4]
const off = (c, dx, dy, dz) => [c[0] + dx, c[1] + dy, c[2] + dz]
/**
 * THE SITE'S CELLS for a lake source `lq` reached along bearing b (S -> lake) -> { S, C, C1, P1, P2, P3, H, W, under1, beyond }.
 * Pure: S is two over the lake surface and one back from its column; the basin is under P2 (H) and P3 (W).
 */
export function siteCells (lq, b) {
  const [dx, dz] = D(b)
  const f = lq[1] + 2
  const S = [lq[0] - dx, f, lq[2] - dz]
  const back = k => [S[0] - dx * k, f, S[2] - dz * k]
  const P1 = back(1), P2 = back(2), P3 = back(3)
  return { S, C: [lq[0], f, lq[2]], C1: [lq[0], f - 1, lq[2]], P1, P2, P3, H: off(P2, 0, -1, 0), W: off(P3, 0, -1, 0),
    under1: off(P1, 0, -1, 0), shore: off(S, 0, -1, 0), beyond: off(back(4), 0, -1, 0), b: ((b % 4) + 4) % 4, lq, f }
}
const N6O = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
const key = c => c.join(',')
/**
 * IS THIS A CAST SITE? -> null (yes) | the reason. Pure over read(x,y,z) -> { name, boundingBox, full, level } | null. `kind` the
 * lake's liquid ('lava' to cast, 'water' to fill the bucket). `inZone(cell)` true for a cell no cast may touch (a protected zone
 * with its bucket reach, the town box, the stair's cells). Unknown is refusal.
 */
export function siteWhy (read, site, { kind = 'lava', inZone = () => false } = {}) {
  const r = c => read(c[0], c[1], c[2])
  const { S, C, C1, P1, P2, P3, H, W, under1, shore, beyond, lq, b } = site
  const all = [lq, C, C1, S, off(S, 0, 1, 0), P1, off(P1, 0, 1, 0), P2, off(P2, 0, 1, 0), P3, off(P3, 0, 1, 0), H, W, under1, shore, beyond]
  if (all.some(c => r(c) == null)) return 'unknown'
  if (all.some(c => inZone(c))) return 'zone'
  if (!isSourceOf(r(lq), kind)) return 'no_source'
  if (!isAir(r(C)) || !isAir(r(C1))) return 'no_cave'          // the ray from S to the lake passes C and C1
  if (!fullDry(r(shore))) return 'shore'
  // the tunnel cells (dug or open), feet and head, and nothing wet beside any of them except the cave cell C ahead of S
  const tunnel = [S, P1, P2, P3].flatMap(c => [c, off(c, 0, 1, 0)])
  const tkeys = new Set(tunnel.map(key))
  for (const c of tunnel) {
    const q = r(c)
    if (liquid(q)) return 'tunnel_wet'   // isOpen is true of lava (an empty box): never a tunnel cell
    if (!(isOpen(q) || isNatural(q))) return 'tunnel_not_natural'
    for (const d of N6O) {
      const n = off(c, ...d)
      if (tkeys.has(key(n)) || key(n) === key(C)) continue
      const nb = r(n)
      if (nb == null) return 'unknown'
      if (liquid(nb)) return 'tunnel_wet'
    }
  }
  // the floor under P1 (the bot's stand for the pours), the shore under S: full. The basin H, W: natural rock to dig, held in by
  // full dry blocks on every side but each other, and a full floor
  if (!fullDry(r(under1))) return 'stand_floor'
  const [dx, dz] = D(b)
  const lat = c => [off(c, dz, 0, dx), off(c, -dz, 0, -dx)]
  for (const c of [H, W]) {
    const q = r(c)
    if (!(isFull(q) && isNatural(q))) return 'basin_not_rock'
    if (!fullDry(r(off(c, 0, -1, 0)))) return 'basin_floor'
    for (const w of lat(c)) if (!fullDry(r(w))) return 'basin_wall'
  }
  if (!fullDry(r(beyond))) return 'basin_wall'
  return null
}
/**
 * THE WAY TO A SITE'S STAND -> [{ start, b, len }] (at most two straight legs: across, then along the site's bearing into S) |
 * null. Pure. The last leg must run through P3, P2 and P1 (the basin's row), so it starts at least 3 cells behind S; the feet must
 * be at S's level (the deepen puts the miner at -53). A leg of length 0 is left out.
 */
export function approachLegs (feet, site, max = OBS_APPROACH_MAX) {
  if (!Array.isArray(feet) || feet[1] !== site.f) return null
  const [dx, dz] = D(site.b)
  const S = site.S
  // the corner K: the feet moved across the bearing onto S's line
  const K = dx !== 0 ? [feet[0], feet[1], S[2]] : [S[0], feet[1], feet[2]]
  const along = (S[0] - K[0]) * dx + (S[2] - K[2]) * dz
  if (along < 3) return null
  const across = dx !== 0 ? S[2] - feet[2] : S[0] - feet[0]
  const legs = []
  if (across !== 0) {
    const ab = dx !== 0 ? (across > 0 ? 1 : 3) : (across > 0 ? 0 : 2)
    legs.push({ start: feet, b: ab, len: Math.abs(across) })
  }
  legs.push({ start: K, b: site.b, len: along })
  const total = legs.reduce((s, l) => s + l.len, 0)
  return total <= max ? legs : null
}
/**
 * THE SITES ROUND THE MINER -> [site + { legs, cost }], cheapest approach first. Pure. Scans the box +-r at the lake surface's level
 * (feet - 2) for sources of `kind`, each from the four bearings.
 */
export function findSites (read, feet, { kind = 'lava', r = OBS_SCAN, inZone = () => false, max = 6, skip = new Set() } = {}) {
  if (!Array.isArray(feet)) return []
  const y = feet[1] - 2, out = []
  for (let x = feet[0] - r; x <= feet[0] + r; x++) for (let z = feet[2] - r; z <= feet[2] + r; z++) {
    if (skip.has(`${x},${y},${z}`)) continue
    const q = read(x, y, z)
    if (!isSourceOf(q, kind)) continue
    for (let b = 0; b < 4; b++) {
      const s = siteCells([x, y, z], b)
      if (siteWhy(read, s, { kind, inZone })) continue
      const legs = approachLegs(feet, s)
      if (!legs) continue
      out.push({ ...s, legs, cost: legs.reduce((a, l) => a + l.len, 0) })
    }
  }
  return out.sort((a, b) => a.cost - b.cost).slice(0, max)
}
/**
 * THE CAST'S NEXT STEP -> 'basin' | 'water' | 'lava' | 'pour_lava' | 'scoop_water' | 'dig' | 'pickup' | 'stop:<why>'. Pure over the
 * site's reads now and the bag. One bucket in turn: water into W, the empty bucket to the lake, the lava into H, W back.
 */
export function castNext ({ H = null, W = null, kit = {}, justDug = false } = {}) {
  if (justDug) return 'pickup'
  // the obsidian is in H (the cast) or, when the lava landed in W's water instead, in W: either is dug; W's water goes back first
  if (nm(H) === 'obsidian' || nm(W) === 'obsidian') return isSourceOf(W, 'water') && (kit.buckets ?? 0) > 0 ? 'scoop_water' : 'dig'
  if (isFull(H) || isFull(W)) return (kit.lava ?? 0) > 0 ? 'stop:basin_closed_holding_lava' : 'basin'
  if (isLava(H) || isLava(W)) return 'stop:loose_lava'
  if ((kit.lava ?? 0) > 0) return isSourceOf(W, 'water') ? 'pour_lava' : 'stop:holding_lava_no_water'
  if (isSourceOf(W, 'water')) return (kit.buckets ?? 0) > 0 ? 'lava' : 'stop:no_empty_bucket'
  if ((kit.water ?? 0) > 0) return 'water'
  return 'stop:no_water'
}
/**
 * IS A SPILL STILL OPEN after its seals? -> 'clear' | 'basin' | 'tunnel'. Pure over looseLava's cells: lava at or above the feet's
 * level (the tunnel row, the cave cells beside S) is 'tunnel' -- the trip goes home along its trail at once; lava only below the
 * feet (the basin) is 'basin' -- never walked over (the trail's walk refuses lava), the trip goes home the same way.
 */
export function spillState (cells = [], f) {
  if (!cells.length) return 'clear'
  return cells.some(c => c[1] >= f) ? 'tunnel' : 'basin'
}
/**
 * LOOSE LAVA round the site after a pour -> [[x,y,z]] to seal, nearest the stand first. Pure. Every lava cell in the box over the
 * basin and the tunnel row (one block of margin, f-2..f+2), never the lake's own column beyond S (it is the lake) and never the
 * bot's cells.
 */
export function looseLava (read, site, body = []) {
  const { P3, S, b } = site
  const [dx, dz] = D(b)
  const xs = [P3[0], S[0]], zs = [P3[2], S[2]]
  const x0 = Math.min(...xs) - 1, x1 = Math.max(...xs) + 1, z0 = Math.min(...zs) - 1, z1 = Math.max(...zs) + 1
  const skip = new Set(body.map(key))
  const out = []
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) for (let y = site.f - 2; y <= site.f + 2; y++) {
    // the lake side: cells at or beyond the cave column along the bearing belong to the lake
    const along = (x - S[0]) * dx + (z - S[2]) * dz
    if (along >= 1) continue
    const c = [x, y, z]
    if (skip.has(key(c))) continue
    if (isLava(read(x, y, z))) out.push(c)
  }
  // ...and the cave cells beside the stand at the feet's and head's level (Codex r1 B2: a lava put back toward the lake must
  // never be left at S's side)
  for (const c of [site.C, off(site.C, 0, 1, 0)]) if (c && !skip.has(key(c)) && isLava(read(c[0], c[1], c[2]))) out.push(c)
  const P1 = site.P1
  return out.sort((a, b2) => (Math.abs(a[0] - P1[0]) + Math.abs(a[1] - P1[1]) + Math.abs(a[2] - P1[2])) - (Math.abs(b2[0] - P1[0]) + Math.abs(b2[1] - P1[1]) + Math.abs(b2[2] - P1[2])))
}
/** Water out of the basin: any water at the tunnel's level (feet or head of S..P3) after the water pour -> [[x,y,z]]. Pure. */
export function spilledWater (read, site) {
  return [site.S, site.P1, site.P2, site.P3].flatMap(c => [c, off(c, 0, 1, 0)]).filter(c => isWet(read(c[0], c[1], c[2])))
}
/**
 * AN INFINITE WATER SOURCE TO FILL FROM -> { at, stand } | null, nearest first. Pure. A water source with REFILL (>= 2 source
 * neighbours: the fill takes nothing from the world), air over it, and a dry stand beside it (full floor, open feet and head) on
 * its own level + 1. `inZone(cell)` refuses.
 */
export function waterFill (read, feet, { r = OBS_WATER_SCAN, dy = 10, inZone = () => false } = {}) {
  if (!Array.isArray(feet)) return null
  let best = null, bd = Infinity
  for (let x = feet[0] - r; x <= feet[0] + r; x++) for (let z = feet[2] - r; z <= feet[2] + r; z++) for (let y = feet[1] - dy; y <= feet[1] + dy; y++) {
    const q = read(x, y, z)
    if (!isSourceOf(q, 'water')) continue
    const d2 = (x - feet[0]) ** 2 + (y - feet[1]) ** 2 + (z - feet[2]) ** 2
    if (d2 >= bd) continue
    if (!isAir(read(x, y + 1, z))) continue
    let src = 0
    for (const [ax, az] of BEARINGS) if (isSourceOf(read(x + ax, y, z + az), 'water')) src++
    if (src < 2) continue
    for (const [ax, az] of BEARINGS) {
      const st = [x + ax, y + 1, z + az]
      const fl = read(st[0], y, st[2]), ft = read(...st), hd = read(st[0], y + 2, st[2])
      if (!fullDry(fl) || !isOpen(ft) || !isOpen(hd)) continue
      if (inZone([x, y, z]) || inZone(st)) continue
      best = { at: [x, y, z], stand: st }; bd = d2
      break
    }
  }
  return best
}
export const OBS_SEEKS_MAX = 3               // work calls with no site in the box before the cast is off for the trip
export const OBS_SEAL_MIN = 6                 // blocks in the bag to start a pour: a spill's seals and the basin's fill
export const OBS_LAVA_FAILS = OBS_FAILS_MAX + 2   // failed steps while holding lava before it goes back to the lake and the cast ends
/**
 * THE CAST'S GATE at the top of each step -> 'idle' | 'done:goal' | 'off:<why>' | 'deepen' | 'seek:lava' | 'seek:water' | 'cast'.
 * Pure. Never ends while lava is in the bag (the step's own stop returns it to the lake first). Every 'off' is a different job
 * for the trip: the ore and the branches go on (the refusal chain the tests compose).
 */
export function castGate ({ obs = null, kit = {}, feet = null } = {}) {
  if (!obs || obs.done || obs.off) return 'idle'
  const lava = (kit.lava ?? 0) > 0
  const got = Math.max(0, (kit.obsidian ?? 0) - (obs.got0 ?? 0))
  if (got >= (obs.want ?? 0) && !lava) return 'done:goal'
  if ((obs.fails ?? 0) >= OBS_FAILS_MAX && !lava) return 'off:fails'
  if ((obs.fails ?? 0) >= OBS_LAVA_FAILS) return 'off:lava_held'   // never a whole trip of failed pours: the lava goes back first
  if ((kit.seal ?? 0) < OBS_SEAL_MIN && !lava) return 'off:seal_blocks'
  if ((obs.cycles ?? 0) >= OBS_CYCLES_MAX && !lava) return 'off:cycles'
  if (obs.site) return 'cast'
  if (!Array.isArray(feet)) return 'off:no_position'
  if (feet[1] > OBS_FEET && (obs.deepens ?? 0) < OBS_DEEPEN_TRIES) return 'deepen'
  if (feet[1] !== OBS_FEET) return `off:level_${feet[1]}`
  if ((obs.seeks ?? 0) >= OBS_SEEKS_MAX) return `off:no_${(kit.water ?? 0) + (kit.lava ?? 0) > 0 ? 'lava' : 'water'}_site`
  if ((kit.water ?? 0) + (kit.lava ?? 0) > 0) return 'seek:lava'
  return (kit.buckets ?? 0) > 0 ? 'seek:water' : 'off:no_bucket'
}
/** The `_deepmine op=obs*` row's detail fields. Pure. */
export function obsDetail ({ step = '-', why = '-', site = null, got = '-', want = '-', n = '-' } = {}) {
  const at = site?.lq ? site.lq.join(',') : '-'
  return `step=${step} why=${why} lake=${at} got=${got}/${want} n=${n}`.slice(0, 160)
}
