// RESPAWNFALL-01: A BOT THAT (RE)SPAWNS ON A HIGH PLATFORM CLIMBS DOWN INSTEAD OF WALKING OFF IT
// (docs/reports/respawnfall-01-design-2026-10-24.md). Pure: no bot. `at(x, y, z)` reads a block ({name, boundingBox, shapes?}
// or null for an unloaded cell).
//
// THE CASE (measured 7 d to 10-24): isolated-a's backup holds a bot-built structure over spawn -- 1,118 cells, 503 at y=180
// and 290 at y=125 (cobblestone, logs, dirt; 1-wide bridges and a gappy column at 354,148) -- and the world respawns a dead
// bot on the highest block of a random column within 10 of (355,147): 174 of those 441 columns are the platform.
// isolated-a-Comet died 11 times in a week falling off it (46-118 blocks), a respawn loop. The pathfinder walks the bridges
// and the bot falls; nothing makes it come DOWN.
//
// TWO TESTS, DELIBERATELY DIFFERENT (Codex r1 P1-2):
//   TRIGGER (elevation)   a deadly drop: ELEVATED_MIN open cells under the support, or that drop on EDGE_SIDES of its four
//                         sides. Only a bot within SPAWN_WINDOW_MS of a spawn starts an episode.
//   DONE (doneAt)         a SAFE stance: at most SAFE_DROP - 1 open under the support (breaking it is a fall of <= 3), and
//                         every open side a step of <= SAFE_DROP (or into water). An episode runs until DONE, window or not,
//                         and an unreadable cell never ends it (Codex r1 P1-6, Claude r1 P2-2).
// THE WAY DOWN: skills.mjs rideFloorDown, the existing primitive that places a block under its own floor and breaks the
// floor (a one-block drop each step; free where a column is already there), from the cheapest reachable column within
// START_RADIUS (rankStarts), priced by simulating it (descentCost). One carried block per open cell to bridge; a bot that
// carries too few writes `_needs_rescue` and STAYS -- the owner's choice over walking off.
export const ELEVATED_MIN = 8          // a fall of >= 8 onto rock costs >= 5 hp, and kills onto a stalagmite tip
export const SAFE_DROP = 3             // vanilla: fall damage = ceil(d - 3); Baritone's maxFallHeightNoWater is 3 too
export const SCAN = 400                // the build limit is 320 above -64: read the whole column
export const SPAWN_WINDOW_MS = 10 * 60 * 1000
export const MARGIN = 2                // blocks kept in hand beyond a non-zero count (a mistimed placement retries)
// A COLUMN STANDING IN THE AIR, NOT A CLIFF TOP: the side trigger needs this many of the four sides to be deadly drops. A
// pillar (alone, or inside a deck whose cells are over the void) has four; a natural cliff edge has one, a corner two -- a
// bot that spawns beside a ravine is not on a platform and must not dig itself a shaft beside it.
export const EDGE_SIDES = 3
export const START_RADIUS = 8
export const SAVE_MIN = 4              // another column must save this many blocks over the own one (a deck walk has its own risk)
export const SPAWN_GRACE_MS = 3000
export const TRANSIENT_MAX_MS = 60_000 // an episode waits this long on transient readings, then hands the bot back     // no floor dig in the first 3 s after a spawn: the server drops them (ghost blocks, 09-29)

/**
 * THE ESCAPE LATTICE STANDS ASIDE WHILE sky_descend OWNS THE EPISODE (Codex r1 P1-3, Claude r1 P2-4): a bot held for
 * rescue (bot.skyHoldUntil, the stay and every run) or inside an active episode (bot.skyActive, cognitive.mjs) gets none of
 * the marooned rungs -- not step_off (the walk-off), not dig_down (priced by health, not by SAFE_DROP), not climb (back up
 * its own column). reflex.mjs asks this at the maroon check and the last-resort branch. Pure.
 */
export const skyEscapeBlocked = (bot, now = Date.now()) => (bot?.skyHoldUntil ?? 0) > now || bot?.skyActive === true
/** Kept for the row and the tests: the hold alone. */
export const skyHoldActive = (bot, now = Date.now()) => (bot?.skyHoldUntil ?? 0) > now

/** RESPAWNFALL=0 turns the order off (the one-setting rollback); anything else, or unset, leaves it on. */
export const respawnfallOn = (env = typeof process !== 'undefined' ? process.env : {}) => String(env?.RESPAWNFALL ?? '1') !== '0'

const LIQ = /^(water|flowing_water|bubble_column|lava|flowing_lava)$/
const kind = b => {
  if (b == null) return 'unknown'
  const n = String(b.name ?? '')
  if (/lava/.test(n)) return 'lava'
  if (LIQ.test(n) || /^(kelp|kelp_plant|seagrass|tall_seagrass)$/.test(n)) return 'water'
  return b.boundingBox === 'block' ? 'solid' : 'open'
}
/**
 * A FULL CUBE: the only support the descent rides (Codex r1 P2-9). rideFloorDown reads its floor at feet - 1, which on a
 * bottom slab is the cell UNDER the slab; a stance on a slab, stair, path or farmland is walked off first (rankStarts never
 * offers one). A block without `shapes` (the tests' fakes) is a cube.
 */
export const fullCube = b => {
  if (kind(b) !== 'solid') return false
  const sh = b.shapes
  if (!Array.isArray(sh)) return true
  return sh.length === 1 && sh[0].length === 6 && sh[0][0] === 0 && sh[0][1] === 0 && sh[0][2] === 0 && sh[0][3] === 1 && sh[0][4] === 1 && sh[0][5] === 1
}

/** The support cell under a body whose feet are at `pos`: feet 181.0 stand on y=180, a slab's 180.5 on y=180 too. */
export const supportOf = pos => ({ x: Math.floor(pos.x), y: Math.floor(pos.y - 1e-3), z: Math.floor(pos.z) })

/**
 * The column under the support cell: {open, landing, landY}. `open` counts the open cells straight down before the first
 * non-open one; landing is what that cell is ('solid', 'water', 'lava', 'unknown'), or 'deep' if nothing within SCAN.
 * Pure; never throws (a throwing reader reads as unknown).
 */
export function columnUnder (at, s, { scan = SCAN } = {}) {
  let open = 0
  for (let y = s.y - 1; y >= s.y - scan; y--) {
    let b
    try { b = at(s.x, y, s.z) } catch { b = null }
    const k = kind(b)
    if (k === 'open') { open++; continue }
    return { open, landing: k, landY: y }
  }
  return { open, landing: 'deep', landY: null }
}

/**
 * A memoised reader for pricing many columns at once: kindAt(x, y, z) reads each cell once, run(x, y, z) is the open run
 * from y DOWN (0 when y itself is not open) with its landing kind, computed once per cell, block(x, y, z) the raw block.
 */
export function columnReader (at, { scan = SCAN } = {}) {
  const blocks = new Map(), runs = new Map()
  const block = (x, y, z) => {
    const k = `${x},${y},${z}`
    if (!blocks.has(k)) { let b; try { b = at(x, y, z) } catch { b = null } blocks.set(k, b ?? null) }
    return blocks.get(k)
  }
  const kindAt = (x, y, z) => kind(block(x, y, z))
  const run = (x, y0, z) => {
    const path = []
    let y = y0, base
    for (;;) {
      const k = `${x},${y},${z}`
      if (runs.has(k)) { base = runs.get(k); break }
      const kd = kindAt(x, y, z)
      if (kd !== 'open') { base = { open: 0, landing: kd, landY: y }; runs.set(k, base); break }
      if (y0 - y >= scan) { base = { open: 0, landing: 'deep', landY: null }; break }
      path.push(k); y--
    }
    for (let i = path.length - 1; i >= 0; i--) { base = { open: base.open + 1, landing: base.landing, landY: base.landY }; runs.set(path[i], base) }
    return base
  }
  return { block, kindAt, run }
}

const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]]
/** A side's drop for a body stepping off support level y: from the side cell itself when open, else from under it. */
const sideRun = (R, x, y, z) => (R.kindAt(x, y, z) === 'open' ? R.run(x, y, z) : R.run(x, y - 1, z))

/**
 * THE TRIGGER at support (x, y, z) on reader R: {exposed, own, sides, blind} or null when its own column is unreadable.
 * Exposed: its own run >= ELEVATED_MIN onto anything but water, or >= EDGE_SIDES sides whose drop is >= ELEVATED_MIN onto
 * anything but water. A water landing under the own column does NOT end the side test (Codex r1 P1-7).
 */
function exposedAt (R, x, y, z) {
  const own = R.run(x, y - 1, z)
  if (own.landing === 'unknown') return null
  if (own.landing !== 'water' && own.open >= ELEVATED_MIN) return { exposed: true, own, sides: 0, blind: false }
  let blind = false, sides = 0
  for (const [dx, dz] of SIDES) {
    if (R.kindAt(x + dx, y, z + dz) === 'unknown') { blind = true; continue }
    const r = sideRun(R, x + dx, y, z + dz)
    if (r.landing === 'unknown') { blind = true; continue }
    if (r.landing !== 'water' && r.open >= ELEVATED_MIN) sides++
  }
  return { exposed: sides >= EDGE_SIDES, own, sides, blind }
}

export const GROUNDED_MIN = 8          // a support with this many solid cells straight under it stands on the ground
export const REGION_DROP = 6           // the walk profile's maxDropDown (index.mjs): where the model's own walks can take the bot

/** The top of a block's collision box (1 for a cube, 0.5 for a bottom slab; a fake without shapes is a cube). Pure. */
const topOf = b => {
  const sh = b?.shapes
  if (!Array.isArray(sh) || !sh.length) return 1
  return Math.max(...sh.map(q => q[4] ?? 1))
}
/** Feet-to-landing fall for a run {open, landY} at column (x, z): open cells plus the landing block's missing top. */
const fallOf = (R, x, z, r) => r.open + (r.landY == null ? 0 : 1 - topOf(R.block(x, r.landY, z)))
/** Is support (x, y, z) on the ground: GROUNDED_MIN solid cells straight under it? */
const groundedAt = (R, x, y, z) => { for (let k = 1; k <= GROUNDED_MIN; k++) if (R.kindAt(x, y - k, z) !== 'solid') return false; return true }
/** A stance: a solid support with two open cells over it. */
const stanceAt = (R, x, y, z) => R.kindAt(x, y, z) === 'solid' && R.kindAt(x, y + 1, z) === 'open' && R.kindAt(x, y + 2, z) === 'open'

/**
 * THE REGION A BODY CAN WALK FROM SUPPORT `s` (Claude r2 P1-1, Codex r2 P1-2): a flood within `radius` over stances, each
 * step to a side one up (a jump) or level or down at most REGION_DROP through open cells -- where the model's own walks
 * (maxDropDown 6) can take the bot, so a tree top on the deck reaches the deck. -> {grounded, floating, blind, n}:
 *   grounded  some stance in it stands on the ground (GROUNDED_MIN solid cells under it)
 *   floating  the first stance in it with ELEVATED_MIN open under it onto anything but water (a deck cell)
 * A region with a floating stance and NO grounded one is a PLATFORM: a deck, a thick patch of deck, a tree standing on a
 * deck. A bot on the ground beside a bridge is not on one (its own stance is grounded); a cliff top is not (no stance in it
 * floats). Pure.
 */
export function regionAt (R, s, { radius = START_RADIUS, cap = 900 } = {}) {
  const key = c => `${c.x},${c.y},${c.z}`
  const seen = new Set([key(s)]), q = [s]
  let grounded = false, floating = null, blind = false
  while (q.length && seen.size <= cap) {
    const c = q.shift()
    if (!grounded && groundedAt(R, c.x, c.y, c.z)) grounded = true
    if (!floating) {
      const own = R.run(c.x, c.y - 1, c.z)
      if (own.landing === 'unknown') blind = true
      else if (own.landing !== 'water' && own.open >= ELEVATED_MIN) floating = c
    }
    for (const [dx, dz] of SIDES) {
      const nx = c.x + dx, nz = c.z + dz
      if (Math.abs(nx - s.x) > radius || Math.abs(nz - s.z) > radius) continue
      let next = null
      if (R.kindAt(c.x, c.y + 3, c.z) === 'open' && stanceAt(R, nx, c.y + 1, nz)) next = { x: nx, y: c.y + 1, z: nz }
      else {
        // level or down: the body moves into the side column at feet/head height, then falls through open cells
        if (R.kindAt(nx, c.y + 1, nz) !== 'open' || R.kindAt(nx, c.y + 2, nz) !== 'open') { if (R.kindAt(nx, c.y + 1, nz) === 'unknown') blind = true; continue }
        for (let dy = 0; dy >= -REGION_DROP; dy--) {
          const k = R.kindAt(nx, c.y + dy, nz)
          if (k === 'unknown') { blind = true; break }
          if (k === 'solid') { next = { x: nx, y: c.y + dy, z: nz }; break }
          if (k !== 'open') break                                   // a liquid: not a walk
        }
      }
      if (!next || seen.has(key(next))) continue
      seen.add(key(next)); q.push(next)
    }
  }
  return { grounded, floating, blind, n: seen.size, platform: !!floating && !grounded }
}

/**
 * DONE at support (x, y, z): {done, unknown, why}. A safe stance: at most SAFE_DROP - 1 open under the support or water
 * under it (so even breaking it is a fall of <= SAFE_DROP), NO side a deadly drop (>= ELEVATED_MIN onto anything but
 * water), and at least one SAFE EXIT -- a side a body can step into (feet and head cells open) whose drop is <= SAFE_DROP
 * or water (a flat step onto a block counts that block's own column: a step onto a deck cell is still on the platform) -- unless every side is a wall (enclosed: the entombed reflex's case, not a platform's). A side
 * dropping 4..7 beside a safe exit is ordinary terrain: the pathfinder takes such a drop only as a planned one (maxDropDown
 * 6). An unreadable cell is unknown, never done. Pure.
 */
export function doneAt (R, x, y, z) {
  const own = R.run(x, y - 1, z)
  if (own.landing === 'unknown') return { done: false, unknown: true, why: 'the column below is not loaded' }
  if (own.landing === 'lava') return { done: false, unknown: false, why: 'lava below' }     // never a landing (Codex r2 P1-1)
  // breaking the support is a fall of open + 1 onto the landing's real top (a bottom slab is half a block lower: Codex r2 P2-5)
  if (!(own.landing === 'water' || own.open + 1 + (own.landY == null ? 0 : 1 - topOf(R.block(x, own.landY, z))) <= SAFE_DROP)) return { done: false, unknown: false, why: `${own.open} open below` }
  // ON THE GROUND, a deadly side is terrain (a natural pit beside the landing: Codex r2 P2-4), not a platform edge
  const ground = groundedAt(R, x, y, z)
  let exits = 0, walls = 0, deadly = 0, deadlyWhy = null
  for (const [dx, dz] of SIDES) {
    const f = R.kindAt(x + dx, y + 1, z + dz), h = R.kindAt(x + dx, y + 2, z + dz), sk = R.kindAt(x + dx, y, z + dz)
    if (f === 'unknown' || h === 'unknown' || sk === 'unknown') return { done: false, unknown: true, why: 'a side is not loaded' }
    // the side's drop: from the side cell when it is open; under it when it is a block -- a flat step onto a DECK cell is
    // a step onto the platform, not off it, so its own column counts. Asked of a WALLED side too: a body riding down under
    // a deck has the deck at its feet's level all round and the void just below it -- an overhang, not an enclosure
    const r = sk === 'open' ? R.run(x + dx, y, z + dz) : R.run(x + dx, y - 1, z + dz)
    if (r.landing === 'unknown') return { done: false, unknown: true, why: 'a side is not loaded' }
    const fall = fallOf(R, x + dx, z + dz, r)
    if (r.landing === 'lava' || (r.landing !== 'water' && r.open >= ELEVATED_MIN)) { deadly++; deadlyWhy ??= `a ${r.open}-block drop beside it${r.landing === 'lava' ? ' into lava' : ''}` }
    if (f !== 'open' || h !== 'open') { walls++; continue }          // a wall: no exit
    if (r.landing !== 'lava' && (r.landing === 'water' || fall <= SAFE_DROP)) exits++
  }
  // a deadly side ends nothing -- unless the stance is on the ground and fewer than EDGE_SIDES sides are deadly (a natural
  // pit or ravine beside the landing is terrain); a pillar with the void on EDGE_SIDES sides is never done, grounded or not
  if (deadly && (!ground || deadly >= EDGE_SIDES)) return { done: false, unknown: false, why: deadlyWhy }
  if (!exits && walls < 4) return { done: false, unknown: false, why: 'no side is a safe step yet' }
  // AND NOT STILL ON THE PLATFORM: a locally safe stance on a thick patch of deck, or on a tree standing on the deck, is
  // still on it (Claude r2 P1-1)
  const reg = regionAt(R, { x, y, z })
  if (reg.platform) return { done: false, unknown: false, why: `still on a platform (a floating cell at ${reg.floating.x},${reg.floating.y},${reg.floating.z})` }
  if (reg.blind && !reg.grounded) return { done: false, unknown: true, why: 'the region around it is not loaded' }
  return { done: true, unknown: false, why: walls === 4 ? 'enclosed' : 'a safe stance' }
}

/**
 * Is the bot ELEVATED (the trigger)? -> {elevated, why, open, landing, support, transient?, partial?}. Grounded on a solid
 * support only. TRANSIENT readings -- no position, in the air, no solid support (a rejected dig's ghost air, an edge's open
 * side), an unloaded column -- are flagged: an episode in progress waits on them, never ends on them.
 */
export function elevation ({ pos, at, onGround = true, inWater = false }) {
  if (!pos || ![pos.x, pos.y, pos.z].every(Number.isFinite)) return { elevated: false, why: 'no position', transient: true }
  // IN WATER: swimming is travel, and never a reading to wait on (Codex r2 P1-3, Claude r2 P2-2)
  if (inWater) return { elevated: false, why: 'in water', water: true }
  if (!onGround) return { elevated: false, why: 'not on the ground', transient: true }
  const s = supportOf(pos)
  const R = columnReader(at)
  const sb = R.block(s.x, s.y, s.z)
  if (kind(sb) !== 'solid') return { elevated: false, why: 'no solid support', support: s, transient: true }
  const e = exposedAt(R, s.x, s.y, s.z)
  if (e == null) return { elevated: false, why: 'the column below is not loaded yet', unknown: true, transient: true, support: s }
  const base = { support: s, open: e.own.open, landing: e.own.landing, landY: e.own.landY, partial: !fullCube(sb), sides: e.sides }
  if (e.exposed && e.own.open >= ELEVATED_MIN && e.own.landing !== 'water') return { elevated: true, why: `${e.own.open} open below onto ${e.own.landing}`, ...base }
  if (e.exposed) return { elevated: true, why: `a deadly drop on ${e.sides} sides of the support`, ...base }
  if (e.blind) return { elevated: false, why: 'a side column is not loaded yet', unknown: true, transient: true, ...base }
  // A TREE ON THE DECK, OR A THICK PATCH OF IT: locally safe, but every way off leads onto the platform (Codex r2 P1-2)
  const reg = regionAt(R, s)
  if (reg.platform) return { elevated: true, why: `on a platform: a floating cell at ${reg.floating.x},${reg.floating.y},${reg.floating.z} and no ground within ${START_RADIUS}`, ...base, region: true }
  return { elevated: false, why: e.own.landing === 'water' ? 'water below and no deadly sides' : `only ${e.own.open} open below`, ...base }
}

/** The open run under the support alone, less SAFE_DROP: the row's lower bound (descentCost is the price). */
export const blocksNeeded = el => Math.max(0, (el?.open ?? 0) - SAFE_DROP)

/**
 * WHAT A DESCENT STRAIGHT DOWN FROM SUPPORT `s` COSTS, by simulating rideFloorDown: each step breaks the support (it must
 * be breakable: `diggable(x, y, z)` -> {ok, why}, default ok -- Claude r1 P2-3) and drops one; the cell under it is ridden
 * for free when solid and bridged with ONE carried block when open (a placed block is the bot's own and is not asked).
 * Only cells above the support change, so the runs below stay as read. Over at the first doneAt support.
 * -> {ok, cost, steps, why, endY}. Not ok: a liquid one or two below (rideFloorDown stops at a liquid two below), an
 * unloaded cell, a support that cannot be broken, or more than SCAN steps. Pure; never throws.
 */
export function descentCost (at, s, { scan = SCAN, R = columnReader(at, { scan }), diggable = null } = {}) {
  let cost = 0, y = s.y, placedAt = null
  for (let step = 0; step <= scan; step++) {
    const d = doneAt(R, s.x, y, s.z)
    if (d.done) return { ok: true, cost, steps: step, why: step ? `${step} steps down, ${cost} placed` : 'already off the platform', endY: y }
    if (d.unknown) return { ok: false, cost, steps: step, why: d.why, endY: y }
    const k = R.kindAt(s.x, y - 1, s.z), k2 = R.kindAt(s.x, y - 2, s.z)
    if (k === 'unknown' || k2 === 'unknown') return { ok: false, cost, steps: step, why: 'an unloaded cell below', endY: y }
    if (k === 'lava' || k === 'water' || k2 === 'lava' || k2 === 'water') {
      const which = [k, k2].find(v => v === 'lava' || v === 'water')
      return { ok: false, cost, steps: step, why: `${which} under the column at y=${y - (k === 'lava' || k === 'water' ? 1 : 2)}`, endY: y }
    }
    if (diggable && placedAt !== y) {
      let g
      try { g = diggable(s.x, y, s.z) } catch { g = { ok: false, why: 'unreadable' } }
      if (!g?.ok) return { ok: false, cost, steps: step, why: g?.why ?? `cannot break the support at y=${y}`, endY: y }
    }
    if (k === 'solid' && !fullCube(R.block(s.x, y - 1, s.z))) return { ok: false, cost, steps: step, why: `a partial block (${R.block(s.x, y - 1, s.z)?.name}) in the column at y=${y - 1}`, endY: y }
    if (k === 'open') { cost++; placedAt = y - 1 } else placedAt = null
    y--
  }
  return { ok: false, cost, steps: scan, why: 'deeper than the scan', endY: y }
}

/** Is the descent from support `s` over? -> {done, unknown, why} on a fresh read (skyDescend's loop, cognitive's episode). */
export const descentDone = (at, s) => doneAt(columnReader(at), s.x, s.y, s.z)

/**
 * THE PLACES TO START, best first (Codex r1 P1-5, Claude r1 P3-10): the own support (when it is a full cube and priced) and
 * every stance REACHABLE from it on its own level -- a 4-connected flood over full-cube supports with two open cells over
 * them, within `radius` -- priced by descentCost. A cell other than the own one is offered only when it saves SAVE_MIN
 * blocks (and the cost of its walk: one block per 4 cells walked); sorted by cost, then walk. `exclude` holds cells whose
 * walk already failed. -> [{cell, cost, dist, own, why}]. Pure; never throws.
 */
export function rankStarts ({ at, support, radius = START_RADIUS, diggable = null, exclude = null }) {
  const R = columnReader(at)
  const key = c => `${c.x},${c.y},${c.z}`
  const stance = c => fullCube(R.block(c.x, c.y, c.z)) && R.kindAt(c.x, c.y + 1, c.z) === 'open' && R.kindAt(c.x, c.y + 2, c.z) === 'open'
  const out = []
  const ownOk = fullCube(R.block(support.x, support.y, support.z))
  const own = ownOk ? descentCost(at, support, { R, diggable }) : { ok: false, why: 'not a full block' }
  if (own.ok) out.push({ cell: support, cost: own.cost, dist: 0, own: true, why: own.why })
  // the flood: the own cell need not be a stance (a slab, the bot's own feet), its neighbours must
  const seen = new Set([key(support)]), q = [[support, 0]]
  while (q.length) {
    const [c, d] = q.shift()
    for (const [dx, dz] of SIDES) {
      const n = { x: c.x + dx, y: c.y, z: c.z + dz }
      if (Math.abs(n.x - support.x) > radius || Math.abs(n.z - support.z) > radius || seen.has(key(n))) continue
      seen.add(key(n))
      if (!stance(n)) continue
      q.push([n, d + 1])
      if (exclude?.has?.(key(n))) continue
      const p = descentCost(at, n, { R, diggable })
      if (!p.ok) continue
      const walk = Math.floor((d + 1) / 4)
      if (own.ok && own.cost - p.cost < SAVE_MIN + walk) continue
      out.push({ cell: n, cost: p.cost, dist: d + 1, own: false, why: p.why })
    }
  }
  return out.sort((a, b) => a.cost + Math.floor(a.dist / 4) - (b.cost + Math.floor(b.dist / 4)) || a.dist - b.dist)
}
/** The best start, or null (the tests' and the row's view of rankStarts). */
export const cheapestStart = args => rankStarts(args)[0] ?? null

/** A log's planks: the 2x2 grid needs no table, and one log is four planks -- three more blocks to place. */
export const PLANKS_PER_LOG = 4

/**
 * Should the `sky_descend` order be issued now? -> {issue, why, state}. Pure.
 *   STARTS  an elevated bot within SPAWN_WINDOW_MS of a spawn (login or respawn) -> state.active.
 *   RUNS    while active, window or not, until `done` (descentDone at the support: {done, unknown}) is TRUE. An unknown
 *           or transient reading keeps the episode and still issues the order (the skill waits on it): the model never
 *           gets a turn while the episode is open (Codex r1 P1-6, Claude r1 P2-2).
 *   on      RESPAWNFALL
 */
export function descendOrder ({ now = Date.now(), lastSpawnAt = null, el = null, done = null, state = {}, on = true }) {
  const s = { ...state }
  if (!on) { s.active = false; return { issue: false, why: 'off', state: s } }
  if (s.active) {
    if (done?.done === true && !el?.transient) { s.active = false; s.transientSince = null; return { issue: false, why: 'down: a safe stance', state: s } }
    // SWIMMING ends it (poolescape and the swim reflexes own a wet body); so does a transient reading that lasts
    // TRANSIENT_MAX_MS (a ladder, a snow layer, a body the server keeps in the air): the bot is handed back, with the row
    if (el?.water) { s.active = false; s.transientSince = null; return { issue: false, why: 'in water: swimming is travel', state: s, ended: 'water' } }
    if (el?.transient) {
      s.transientSince ??= now
      if (now - s.transientSince > TRANSIENT_MAX_MS) { s.active = false; s.transientSince = null; return { issue: false, why: `transient for ${Math.round(TRANSIENT_MAX_MS / 1000)} s (${el.why})`, state: s, ended: 'transient' } }
    } else s.transientSince = null
    return { issue: true, why: el?.elevated ? el.why : `episode open: ${el?.transient ? `waiting (${el.why})` : (done?.why ?? el?.why ?? 'not down yet')}`, state: s }
  }
  const inWindow = lastSpawnAt != null && now - lastSpawnAt <= SPAWN_WINDOW_MS
  if (!el?.elevated) return { issue: false, why: el?.why ?? 'not elevated', state: s }
  if (!inWindow) return { issue: false, why: 'not since a spawn', state: s }
  s.active = true
  return { issue: true, why: el.why, state: s }
}

/** One line for the `_sky_descend` row, evidence first. Pure. */
export function describeDescent ({ outcome, el, have, need, startY, endY, placed = 0, rode = 0, stopped = null, walked = null, crafted = 0 }) {
  return `${outcome}: y ${startY?.toFixed?.(1) ?? startY} -> ${endY?.toFixed?.(1) ?? endY}; open below ${el?.open ?? '?'} onto ${el?.landing ?? '?'}; ` +
    `blocks have ${have} need ${need}; placed ${placed} rode ${rode}${walked ? `; walked ${walked}` : ''}${crafted ? `; planks from ${crafted} log(s)` : ''}${stopped ? `; stopped: ${stopped}` : ''}`
}

/**
 * The stay's reason (and the `_needs_rescue` detail). It says only what is true and what happens next (Claude r1 P1-1):
 * the bot is HELD, the order comes back every decision, and the flag is up. No advice it cannot act on. Pure.
 */
export function stayRefusal ({ el, have, need, why = null }) {
  const where = `${el?.open ?? '?'} open blocks below onto ${el?.landing ?? '?'}`
  if (why) return `sky_descend: staying put -- ${where}, and no column within ${START_RADIUS} it can climb down (${why}); walking off is a fall. Held here for rescue (_needs_rescue raised); it re-checks every decision`
  return `sky_descend: staying put -- ${where}; the cheapest column down needs ${need + (need > 0 ? MARGIN : 0)} placeable blocks and it carries ${have} ` +
    `(its logs already turned into planks); walking off is a fall. Held here for rescue (_needs_rescue raised); it climbs down as soon as it carries enough`
}

/** The licence row's detail (`_respawnfall_mode`, once per spawn). */
export const respawnfallModeDetail = (env = typeof process !== 'undefined' ? process.env : {}) =>
  `on=${respawnfallOn(env) ? 1 : 0} elevated_min=${ELEVATED_MIN} safe_drop=${SAFE_DROP} window_min=${SPAWN_WINDOW_MS / 60000} margin=${MARGIN} edge_sides=${EDGE_SIDES} radius=${START_RADIUS} save_min=${SAVE_MIN} way=cheapest_column+ride_floor_down`
