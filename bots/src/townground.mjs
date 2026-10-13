// THE TOWN'S GROUND (townground-2026-10-13.md, sections 2.3-2.4). Pure: no bot, no world reads.
//
// WHY. Measured 10-13 (region files, fresh seed terrain regenerated on Paper 1.21.8 vs the live worlds, 16 towns): within
// 15 blocks of home the bots have removed 9.0 cells per column since each world began -- 3.4x the 35-48 ring -- and 64%
// of the top four layers. The junk well's site rule then fails in 13 of 16 towns, while the same search on the seed's
// untouched terrain finds a site in 16 of 16 (95-340 valid caps on day 0, 0-7 by day 16-24 in the same worlds).
//
// THIS FILE answers one question: is this cell the town's ground? The `_dig_town` instrument (digtown.mjs) records digs
// by this class; the zone (step 3) refuses DISCRETIONARY target digs of it and prices transit through it.
//
// THE BOX: a SQUARE (Chebyshev) of half-width 16 around home -- the well search reaches Chebyshev 14 and its shell 2
// more -- from home.y - 12 up (candidate caps start at home.y - 8, the ring reaches g - 3). Horizontal distance alone is
// not enough: a circle of 16 leaves the corners of the well search's square uncovered (Codex r1 P2).
//
// GROUND is TERRAIN only. Vegetation (logs, leaves, saplings, plants: the planted trees must stay harvestable) and town
// furniture (containers, stations, beds, torches, trapdoors, the composter: they keep their own rules) are never ground.
// stone_bricks IS ground: it is the town platform place-town.py stamps (13x13 at home.y - 2).
// The zone is OFF (every cell 'free') when home is unknown: that FAILS OPEN, on purpose and by name -- the bot behaves
// exactly as before rather than refusing everything.

export const TOWN_GROUND_HALF = 16
export const TOWN_GROUND_DEPTH = 12
/** The instrument also counts digs this far outside the zone, so a change at the edge is visible. */
export const TOWN_MARGIN = 4

export const TERRAIN = /^(stone|cobblestone|mossy_cobblestone|stone_bricks|deepslate|cobbled_deepslate|andesite|diorite|granite|tuff|calcite|dripstone_block|smooth_basalt|sandstone|red_sandstone|dirt|coarse_dirt|rooted_dirt|grass_block|podzol|mycelium|mud|clay|sand|red_sand|gravel|dirt_path|farmland|terracotta|[a-z_]+_terracotta|moss_block)$|_ore$/

/** -> { x, y, z } | null. A home whose coordinates are not all finite is unknown. */
export function homeOf (h) {
  if (!h) return null
  const x = Number(h.x ?? h.homeX), y = Number(h.y ?? h.homeY), z = Number(h.z ?? h.homeZ)
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) ? { x, y, z } : null
}

/** Is the integer cell inside the town box (grown by `margin`)? Pure. */
export function inTownBox (p, home, { margin = 0 } = {}) {
  const h = homeOf(home)
  if (!h || !p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) return false
  const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z)
  const R = TOWN_GROUND_HALF + margin
  return Math.abs(x - Math.floor(h.x)) <= R && Math.abs(z - Math.floor(h.z)) <= R && y >= Math.floor(h.y) - TOWN_GROUND_DEPTH - margin
}

export const isTerrain = name => typeof name === 'string' && TERRAIN.test(name)

/** 'ground' | 'free'. Pure. */
export function townDigClass (p, blockName, home) {
  return inTownBox(p, home) && isTerrain(blockName) ? 'ground' : 'free'
}

// ---- THE ZONE (step 3; townground-2026-10-13.md 2.4-2.5) -------------------------------------------------------------
//
// TARGETS are refused, TRANSIT is priced, SURVIVAL is untouched. A target dig is a discretionary one: gather taking a
// block, mine cutting a stair, the ore tunnel excavating. Every refusal names a remedy the bot can perform from where it
// stands -- town ground ends 16 blocks from home and dirt and stone are everywhere past it.
//   gather   candidates are filtered AT ENUMERATION (the 32 nearest matches would otherwise all be town ground and the
//            reachable ones outside never enter the list: Codex r1 P1); its target test is an independent conjunction.
//   mine     the old full-depth 12-block rule stays; a bearing whose stair would cut town ground is not chosen; every step
//            re-checks its three cells; with no clear bearing the skill WALKS OUT (deterministic) and tries once more.
//   tunnel   ground costs 100 in the tunnel's own profile (a refusal: the tunnel re-plans around it).
//   transit  every other dig-capable profile prices ground at TRANSIT_COST (< 100): a bot in a town pit can always dig out.
export const TRANSIT_COST = 30
export const TOWN_GROUND_REMEDY = `town ground: within ${TOWN_GROUND_HALF} blocks of home (above home.y - ${TOWN_GROUND_DEPTH}) the town's ground is kept -- take dirt, sand, gravel or stone more than ${TOWN_GROUND_HALF} blocks from home`

/** May a DISCRETIONARY dig take this cell? -> { ok, reason, remedy }. Pure. */
export function townTargetPermit (p, blockName, home) {
  if (townDigClass(p, blockName, home) !== 'ground') return { ok: true, reason: null, remedy: null }
  return { ok: false, reason: 'town_ground', remedy: TOWN_GROUND_REMEDY }
}

/**
 * Would a `mine` staircase from `from` along `bear` cut town ground? Pure (nameAt(x,y,z) -> block name | null).
 * The stair's cells at step i (skills.mjs descentStepCells): feet/head/above one along and i down. Followed until every
 * cell of a step is outside the box (horizontally beyond it, or below the band); an unknown cell inside the box counts
 * as ground (never on a guess). -> { clear, steps, cell } (cell: the first ground cell, if any).
 */
export function stairTownClear (from, bear, home, nameAt, maxSteps = 2 * TOWN_GROUND_HALF + TOWN_GROUND_DEPTH + 8) {
  const h = homeOf(home)
  if (!h || !from || !bear) return { clear: true, steps: 0, cell: null }
  for (let i = 0; i < maxSteps; i++) {
    const sx = Math.floor(from.x) + bear.x * (i + 1), sy = Math.floor(from.y) - i, sz = Math.floor(from.z) + bear.z * (i + 1)
    const cells = [{ x: sx, y: sy - 1, z: sz }, { x: sx, y: sy, z: sz }, { x: sx, y: sy + 1, z: sz }]
    const inside = cells.filter(c => inTownBox(c, h))
    if (!inside.length) {
      // below the band, or beyond the square while still descending: a later step cannot climb back in
      if (sy + 1 < Math.floor(h.y) - TOWN_GROUND_DEPTH) return { clear: true, steps: i, cell: null }
      const dx = sx - Math.floor(h.x), dz = sz - Math.floor(h.z)
      if (Math.sign(dx) === Math.sign(bear.x) && bear.x && Math.abs(dx) > TOWN_GROUND_HALF) return { clear: true, steps: i, cell: null }
      if (Math.sign(dz) === Math.sign(bear.z) && bear.z && Math.abs(dz) > TOWN_GROUND_HALF) return { clear: true, steps: i, cell: null }
      continue
    }
    for (const c of inside) {
      const n = nameAt(c.x, c.y, c.z)
      if (n == null || isTerrain(n)) return { clear: false, steps: i, cell: { ...c, name: n } }
    }
  }
  return { clear: true, steps: maxSteps, cell: null }
}

/**
 * WHERE TO WALK so a stair can start outside the town: the nearest point HALF + 3 out along the cardinal that leaves the
 * square soonest, at the bot's own coordinate on the other axis. Pure. -> { x, z, bear }
 */
export function walkOutPoint (from, home) {
  const h = homeOf(home)
  if (!h || !from) return null
  const hx = Math.floor(h.x), hz = Math.floor(h.z), x = Math.floor(from.x), z = Math.floor(from.z), R = TOWN_GROUND_HALF + 3
  const opts = [
    { d: (hx + R) - x, x: hx + R, z, bear: { x: 1, z: 0 } }, { d: x - (hx - R), x: hx - R, z, bear: { x: -1, z: 0 } },
    { d: (hz + R) - z, x, z: hz + R, bear: { x: 0, z: 1 } }, { d: z - (hz - R), x, z: hz - R, bear: { x: 0, z: -1 } },
  ]
  opts.sort((a, b) => a.d - b.d)
  const o = opts[0]
  return { x: o.x, z: o.z, bear: o.bear }
}

/** Per-bot counters for the `_town_ground` liveness row (index.mjs flushes them once a minute). */
export function townGroundCounters () {
  return { gather_skipped: 0, gather_refused: 0, mine_bearing_refused: 0, mine_walkout: 0, mine_step_refused: 0, mine_refused: 0 }
}
export function noteTownGround (bot, key, n = 1) {
  try { if (bot) { bot.townGround ??= townGroundCounters(); bot.townGround[key] = (bot.townGround[key] ?? 0) + n } } catch { /* telemetry */ }
}

/**
 * A precomputed exclusionAreasBreak entry (the A* hot path: no allocation per call). cost TRANSIT_COST for a transit
 * profile, 100 for a target profile. Unknown home -> always 0 (the zone is off).
 */
export function makeTownBreakCost (home, cost) {
  const h = homeOf(home)
  if (!h) return () => 0
  const hx = Math.floor(h.x), hz = Math.floor(h.z), ymin = Math.floor(h.y) - TOWN_GROUND_DEPTH, R = TOWN_GROUND_HALF
  return (block) => {
    const p = block?.position
    if (!p || p.y < ymin || Math.abs(p.x - hx) > R || Math.abs(p.z - hz) > R) return 0
    return TERRAIN.test(block.name ?? '') ? cost : 0
  }
}

/**
 * THE ZONE'S HOME: config's home ONLY when HOME_X, HOME_Y and HOME_Z were set in the environment (every fleet env file
 * sets them; config.mjs defaults a missing one to 0/70/0, which is not a town). Unset -> null -> the zone is off.
 */
export function configuredHome (world, env = process.env) {
  if (env.HOME_X == null || env.HOME_Y == null || env.HOME_Z == null || env.HOME_X === '' || env.HOME_Y === '' || env.HOME_Z === '') return null
  return homeOf({ x: world?.homeX, y: world?.homeY, z: world?.homeZ })
}
