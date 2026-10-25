// KEEPOUT-01: NO DIG IN THE COLUMN ABOVE A MARKED LAVA POOL. Pure parts (no bot, no world reads: callers pass readers).
// Design: docs/reports/comms-design-2026-10-21.md sections 0.2, 2.3, 4.2 (`fire_site`), 4.5, 4.6, 8 row 2, 9 C3/C12
// (Codex + Claude APPROVE r7; owner "yes" to C1-C9 2026-10-22 ~00:00Z; owner "yes" to C12 / item 10 2026-10-22 ~00:05Z).
//
// WHY. hive-b: 6 deaths by 5 bots at one lava pool (335-337, 38, 154) in 3 days WHILE ITS SITE WAS ON FILE and priced.
// Fleet-wide, 7 of 52 fire deaths in 7 days were inside a live fire site. The pathfinder already pays a death site's
// price (deathsites.mjs); what killed Echo and Alpha was not a route but a DIG -- a dirt gather whose target was inside the
// disc, which carried the bot down to the lava (Echo, y 43 -> 38) or dropped it in (Alpha, "fell 6 ... swim in lava").
//
// THE COLUMN of a fire site: every cell within KEEPOUT_RADIUS (6, the death site's own disc: deathsites.mjs) horizontally
// of the site's centre, from the site's y up to y + KEEPOUT_HEIGHT (12). A FIRE SITE: a live death site (weight >= 1, the
// world facts' own decay) of class fire -- one death is enough (a death is a server event, not a sensor reading). Water,
// falls, other and unknown never qualify ("water is terrain"). A site a lava read found clear is `disputed` and does not
// keep anyone out until the next fire death there clears the dispute (worldfacts.mjs).
//
// THE RULE (design 4.6): gather and mine refuse dig candidates in a column WHATEVER THE BODY'S POSITION. Only moving OUT
// is exempt: escape, drowning, entombment, respawn and walk-off moves (the reflexes' digs are `survival`, never `target`),
// and `_keepout_exit`'s own escape digs. Every refusal names a remedy the bot can perform from where it is, and the one
// that must happen is performed, not advised:
//   gather   candidates in a column are skipped at enumeration (findBlocks then returns the nearest ones outside, within
//            32), the walk to one plans a route that never enters a column; none -> the gather ends WITHOUT a dig and
//            (gather, block) is suppressed for this bot for 10 min while it is within 32 blocks of the column;
//   mine     the column joins mine's composed keep-out (minewell.mjs): the WHOLE stair is checked before the first dig,
//            the bearing turns, a walk-off finds a start outside (column-free route, bounded at 32); none -> no dig and
//            mine is suppressed the same way; every stair dig is checked again;
//   inside   a body inside a column runs `_keepout_exit` before any other decision: a walk that only moves outward, else
//            the escape step (dig at or above foot level away from the centre, never below the feet; or climb above the
//            column's top); `failed` hands over to the stranded ladder (also exempt) and backs off 5 min.
// TOWN (C12, OWNER 2026-10-22: "yes"): a column covering a town chest, furnace or home YIELDS for town jobs there --
// `_keepout_exit` does not start for a bot on a town job or at home inside it -- and the read names the town. Gather and
// mine are still refused there. KEEPOUT_TOWN_YIELD is the switch.
import { DEATH_SITE_RADIUS, DEATH_KIND_PREFIX, effectiveCount } from './deathsites.mjs'

export const KEEPOUT_RADIUS = DEATH_SITE_RADIUS        // 6: the death site's own disc
export const KEEPOUT_HEIGHT = 12                       // the column runs from the site's y to y + 12
export const KEEPOUT_SEARCH = 32                       // gather's candidate search and every walk-off are bounded here
export const KEEPOUT_COOLDOWN_MS = 10 * 60 * 1000      // a refused (skill, block) is suppressed this long...
export const KEEPOUT_COOLDOWN_NEAR = 32                // ...while the bot is within this many blocks of the column
export const KEEPOUT_EXIT_BACKOFF_MS = 5 * 60 * 1000   // after a failed `_keepout_exit` the stranded ladder has the body
export const KEEPOUT_EXIT_RADIUS = 16                  // the outward walk looks for a stand outside within this
export const KEEPOUT_DISPUTE_MS = 10 * 60 * 1000       // one lava read per site per bot per this long
export const FIRE_KIND = `${DEATH_KIND_PREFIX}fire`
export const KEEPOUT_KIND = 'lava'                     // the keep-out kind minewell's planner names
/**
 * OWNER DECISION 2026-10-22 ~00:05Z (design C12, owner item 10): "yes" -- a lava site covering a town chest, furnace or
 * home makes the keep-out stand down for town jobs there, and the read reports the town. `false` would push bots out of
 * their own town while it does its jobs (the exit starts for every bot in the column). KEEPOUT_TOWN_YIELD=0 in the env
 * flips it without a build.
 */
export const KEEPOUT_TOWN_YIELD = true
/** The town jobs a yielded column stands down for (cognitive.mjs's deterministic town orders, plus home and deposit). */
export const TOWN_JOB_SKILLS = new Set(['town_deposit', 'withdraw_pick', 'withdraw', 'count_town', 'prune_town', 'smelt_town',
  'furnace_drain', 'toolkit', 'compost', 'build_composter', 'dispose_well', 'build_well', 'close_well', 'build_plinth', 'deposit', 'home',
  // found-01 (JIT 10-23c): the found slot is a deterministic town order like the rest (a town's first chest, table, furnace)
  'found_store', 'found_work'])
/** A bot this close to home (horizontally; |dy| <= 6) is AT home: a yielded column never pushes it out. */
export const HOME_YIELD_RADIUS = 4
const TOWN_BLOCKS = /^(chest|trapped_chest|barrel|furnace|blast_furnace|smoker)$/
const LAVA = /^(lava|flowing_lava)$/

/** The master switch: KEEPOUT=0 is the rollback (the bot behaves exactly as the base). */
export const keepoutOn = (env = process.env) => String(env?.KEEPOUT ?? '1') !== '0'
/** The C12 switch: the constant, unless KEEPOUT_TOWN_YIELD is set in the env. */
export const townYieldOn = (env = process.env) => (env?.KEEPOUT_TOWN_YIELD == null || env.KEEPOUT_TOWN_YIELD === '' ? KEEPOUT_TOWN_YIELD : String(env.KEEPOUT_TOWN_YIELD) !== '0')

/** The licence row's detail (`_keepout_mode`, once per spawn). Pure. */
export function keepoutModeDetail (env = process.env) {
  return `phase=mode keepout=${keepoutOn(env) ? 'on' : 'off'} radius=${KEEPOUT_RADIUS} height=${KEEPOUT_HEIGHT} trigger=fire_site_live search=${KEEPOUT_SEARCH} cooldown_min=${KEEPOUT_COOLDOWN_MS / 60000} town_yield=${townYieldOn(env) ? 'on' : 'off'}`
}

export const siteKey = s => `${s.x},${s.y},${s.z}`
const finite3 = p => !!p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)

/** The fire sites that keep bots out -> sites. Pure. Live (weight >= 1 at `now`), class fire, not disputed. */
export function fireSites (sites, now = Date.now()) {
  if (!Array.isArray(sites)) return []
  return sites.filter(s => s && s.kind === FIRE_KIND && finite3(s) && !s.disputed && effectiveCount(s, now) >= 1)
}

/** Is the integer cell inside this site's column? Pure. The same disc test as deathSiteStepCost (cell vs centre). */
export function inColumn (s, p) {
  if (!s || !finite3(p)) return false
  const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z)
  if (y < s.y || y > s.y + KEEPOUT_HEIGHT) return false
  const dx = s.x - x, dz = s.z - z
  return dx * dx + dz * dz <= KEEPOUT_RADIUS * KEEPOUT_RADIUS
}

/** The fire site whose column holds this cell (the nearest when columns overlap) -> site | null. Pure. */
export function columnAt (sites, p) {
  if (!Array.isArray(sites) || !sites.length || !finite3(p)) return null
  let best = null, bestD = Infinity
  for (const s of sites) {
    if (!inColumn(s, p)) continue
    const d = Math.hypot(s.x - Math.floor(p.x), s.z - Math.floor(p.z))
    if (d < bestD) { best = s; bestD = d }
  }
  return best
}

/** The fire sites within `radius` horizontally of p (the per-run working set: the hot paths test only these). Pure. */
export function sitesNear (sites, p, radius = 64) {
  if (!Array.isArray(sites) || !finite3(p)) return []
  return sites.filter(s => Math.hypot(s.x - p.x, s.z - p.z) <= radius + KEEPOUT_RADIUS)
}

/** keepout as one part of mine's composed keep-out (minewell.mjs composeKeepOut's shape) -> { forbid, bottom }. Pure. */
export function keepOutPart (sites) {
  if (!Array.isArray(sites) || !sites.length) return { forbid: null, bottom: null }
  return { forbid: c => (columnAt(sites, c) ? KEEPOUT_KIND : null), bottom: Math.min(...sites.map(s => s.y)) }
}

/**
 * THE COLUMN-FREE ROUTE (a pathfinder exclusionAreasStep entry's answer for one cell) -> true when a path may NOT step
 * there. Pure. A cell in a column the bot is not standing in is never entered. A cell in the bot's OWN column may be
 * stepped on only if it is not closer to the centre than the bot is now (less 0.5): the way lineHitsDeathSite lets a
 * bot inside a disc walk out, and nothing else.
 */
export function routeForbids (sites, from, cell) {
  if (!Array.isArray(sites) || !sites.length || !finite3(cell)) return false
  if (!sites.some(q => inColumn(q, cell))) return false        // the hot path: most cells are in no column (Claude r2 P3-2)
  // EVERY column the cell is in, judged on its own (Codex r1 P1-3: overlapping columns -- judging only the nearest let a walk
  // that was outward from one centre enter a second column the bot was not in): a column the bot is NOT standing in is
  // never entered; one it IS standing in is crossed only outward from that column's own centre
  const fromIn = finite3(from) ? sites.filter(q => inColumn(q, from)) : []
  for (const q of sites) {
    if (!inColumn(q, cell)) continue
    if (!fromIn.includes(q)) return true
    if (!outward(q, from, cell)) return true
  }
  return false
}
// CELLS AGAINST CELLS (Claude r1 P2-2): the bot's own cell, never its exact position -- a bot mid-cell on the far side of the disc
// read its own cell (and the one above its head, the pathfinder's jump-up / tower test) as "inward" and could not move
const outward = (s, from, cell) => Math.hypot(s.x - Math.floor(cell.x), s.z - Math.floor(cell.z)) >= Math.hypot(s.x - Math.floor(from.x), s.z - Math.floor(from.z))

/**
 * THE OUTWARD WALK'S TARGETS -> [{ x, y, z, d }], nearest first: stand cells outside EVERY column within `radius` of the
 * bot, at the bot's height +- 3 (a walk, not a climb). Pure over `standable(x, y, z)`.
 */
export function exitTargets (sites, from, standable, { radius = KEEPOUT_EXIT_RADIUS, dy = 3 } = {}) {
  if (!finite3(from) || typeof standable !== 'function') return []
  const fx = Math.floor(from.x), fy = Math.floor(from.y), fz = Math.floor(from.z)
  const out = []
  for (let r = 1; r <= radius; r++) {
    for (let ddx = -r; ddx <= r; ddx++) {
      for (let ddz = -r; ddz <= r; ddz++) {
        if (Math.max(Math.abs(ddx), Math.abs(ddz)) !== r) continue
        const x = fx + ddx, z = fz + ddz
        for (const k of [0, 1, -1, 2, -2, 3, -3].filter(v => Math.abs(v) <= dy)) {
          const c = { x, y: fy + k, z }
          if (columnAt(sites, c)) continue
          if (!standable(c.x, c.y, c.z)) continue
          out.push({ ...c, d: Math.hypot(ddx, ddz) + Math.abs(k) * 0.5 })
          break
        }
      }
    }
  }
  return out.sort((a, b) => a.d - b.d || a.x - b.x || a.z - b.z)
}

const CARDINALS = [{ x: 0, z: 1 }, { x: -1, z: 0 }, { x: 0, z: -1 }, { x: 1, z: 0 }]
/** The cardinals that lead AWAY from the site's centre, most directly away first (the escape dig's bearings). Pure. */
export function outwardBearings (site, from) {
  if (!site || !finite3(from)) return []
  let ax = Math.floor(from.x) - site.x, az = Math.floor(from.z) - site.z   // cells against cells, as inColumn (Claude r1 P3-9)
  if (ax === 0 && az === 0) { ax = 1; az = 0 }   // dead centre: any direction is away
  return CARDINALS.map(b => ({ b, dot: b.x * ax + b.z * az })).filter(o => o.dot > 0).sort((p, q) => q.dot - p.dot).map(o => o.b)
}

/**
 * DOES THIS COLUMN COVER THE TOWN? -> { yields, home, containers, furnaces }. Pure over `nameAt(x, y, z)`. Home inside the
 * column (horizontally within the disc, home.y within the column's band +- 2), or any chest / barrel / furnace cell in it.
 */
export function coversTown (site, { home = null, nameAt = null } = {}) {
  const res = { yields: false, home: false, containers: 0, furnaces: 0 }
  if (!site) return res
  if (finite3(home) && Math.hypot(site.x - Math.floor(home.x), site.z - Math.floor(home.z)) <= KEEPOUT_RADIUS &&
      Math.floor(home.y) >= site.y - 2 && Math.floor(home.y) <= site.y + KEEPOUT_HEIGHT + 2) res.home = true
  if (typeof nameAt === 'function') {
    for (let dx = -KEEPOUT_RADIUS; dx <= KEEPOUT_RADIUS; dx++) {
      for (let dz = -KEEPOUT_RADIUS; dz <= KEEPOUT_RADIUS; dz++) {
        if (dx * dx + dz * dz > KEEPOUT_RADIUS * KEEPOUT_RADIUS) continue
        for (let y = site.y; y <= site.y + KEEPOUT_HEIGHT; y++) {
          const n = nameAt(site.x + dx, y, site.z + dz)
          if (!n || !TOWN_BLOCKS.test(n)) continue
          if (/furnace|smoker/.test(n)) res.furnaces++; else res.containers++
        }
      }
    }
  }
  res.yields = res.home || res.containers > 0 || res.furnaces > 0
  return res
}

/**
 * DOES `_keepout_exit` START? -> { start, site, why }. Pure. Inside a column; the switch on; not backing off after a
 * failure; and not a yielded town column while the bot is on a town job (`skill`) or at home.
 */
export function exitDecision ({ sites, pos, home = null, skill = null, yielded = () => false, yieldOn = KEEPOUT_TOWN_YIELD, backoffUntil = 0, now = Date.now() } = {}) {
  const site = columnAt(sites, pos)
  if (!site) return { start: false, site: null, why: 'outside' }
  if (now < backoffUntil) return { start: false, site, why: 'backoff' }
  if (yieldOn && yielded(site)) {
    if (skill && TOWN_JOB_SKILLS.has(skill)) return { start: false, site, why: 'town_job' }
    if (finite3(home) && Math.hypot(pos.x - home.x, pos.z - home.z) <= HOME_YIELD_RADIUS && Math.abs(pos.y - home.y) <= 6) return { start: false, site, why: 'home' }
  }
  return { start: true, site, why: 'inside' }
}

/**
 * GOTO'S ARRIVAL REGION (skills.mjs arrivedAt, range 1: max(1, 3) = 3 horizontally, 3 + 3 = 6 vertically): the cells a
 * relocation can END in and still count as arrived. Pinned against arrivedAt itself by test/keepout-homefix.test.mjs.
 */
export const RELOCATION_ARRIVAL_REACH = 3
export const RELOCATION_ARRIVAL_DY = 6
/**
 * HOMEFIX-02's RELOCATION TARGET IS NEVER IN A COLUMN (keepout-01 x homefix-02): any cell of the goto arrival region -- 3
 * horizontally AND 6 vertically of the target's feet, the whole volume arrivedAt accepts (Codex jit-1022b P1: the feet
 * height alone let a target one block above a column's top land the bot inside it) -- in a live fire column refuses the
 * target. Pure.
 */
export function relocationForbidden (sites, x, y, z, reach = RELOCATION_ARRIVAL_REACH, dyReach = RELOCATION_ARRIVAL_DY) {
  if (!Array.isArray(sites) || !sites.length) return false
  for (let dy = -dyReach; dy <= dyReach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) for (let dz = -reach; dz <= reach; dz++) if (columnAt(sites, { x: x + dx, y: y + dy, z: z + dz })) return true
  }
  return false
}

/**
 * THE EXIT ORDER'S OWN BOOKKEEPING (cognitive.mjs; Codex r1 P1-1 / Codex r2 P2-7) -> { tries, backoffUntil }. Pure. Out
 * (success) or nothing to leave (no_effect) re-arms it; a failure backs off at once; anything else (interrupted by a reflex,
 * aborted by the runner's clock, unverified) counts, and the third in a row backs off too -- the exit can never loop on a
 * bot it cannot move, and while it backs off the escape ladder and the model have the body.
 */
export function exitOutcome (state = {}, status, now = Date.now()) {
  const out = status === 'success' || status === 'no_effect'
  let tries = out ? 0 : (state.tries ?? 0) + 1
  let backoffUntil = out ? 0 : (state.backoffUntil ?? 0)
  if (status === 'failed' || tries >= 3) { backoffUntil = now + KEEPOUT_EXIT_BACKOFF_MS; tries = 0 }
  return { tries, backoffUntil }
}

/** A refused (skill, block) suppressed for this bot -> the matching live entry | null. Pure. */
export function cooldownHit (entries, { skill, block = null, pos, now = Date.now() } = {}) {
  if (!Array.isArray(entries) || !finite3(pos)) return null
  return entries.find(e => e && e.skill === skill && (e.block ?? null) === (block ?? null) && now < e.until &&
    Math.hypot(e.site.x - pos.x, e.site.z - pos.z) <= KEEPOUT_COOLDOWN_NEAR + KEEPOUT_RADIUS) ?? null
}
/** The list with one more entry (expired ones dropped, at most 16 kept). Pure. */
export function addCooldown (entries, { skill, block = null, site, now = Date.now() }) {
  const live = (Array.isArray(entries) ? entries : []).filter(e => now < e.until && !(e.skill === skill && (e.block ?? null) === (block ?? null) && siteKey(e.site) === siteKey(site)))
  return [...live, { skill, block: block ?? null, site: { x: site.x, y: site.y, z: site.z }, until: now + KEEPOUT_COOLDOWN_MS }].slice(-16)
}

/**
 * THE LAVA READ that disputes a site (design 4.2): every cell of the disc from y - 6 to the column's top, loaded, and
 * none lava -> 'clear'; any lava -> 'lava'; any unloaded cell -> 'unloaded' (unknown is never "gone"). Pure.
 */
export function disputeScan (site, nameAt) {
  if (!site || typeof nameAt !== 'function') return 'unloaded'
  let unloaded = false
  for (let dx = -KEEPOUT_RADIUS; dx <= KEEPOUT_RADIUS; dx++) {
    for (let dz = -KEEPOUT_RADIUS; dz <= KEEPOUT_RADIUS; dz++) {
      if (dx * dx + dz * dz > KEEPOUT_RADIUS * KEEPOUT_RADIUS) continue
      for (let y = site.y - 6; y <= site.y + KEEPOUT_HEIGHT; y++) {
        const n = nameAt(site.x + dx, y, site.z + dz)
        if (n == null) { unloaded = true; continue }
        if (LAVA.test(n)) return 'lava'
      }
    }
  }
  return unloaded ? 'unloaded' : 'clear'
}

/** Cells as one compact string for a row's args ("x,y,z;x,y,z"). Pure. */
export const encodeCells = cells => (cells ?? []).map(c => `${c.x},${c.y},${c.z}`).join(';')
/** How many of these cells lie in a column. Pure. */
export const cellsInColumns = (sites, cells) => (cells ?? []).filter(c => columnAt(sites, c)).length

/** Per-bot counters for the `_keepout` liveness row (index.mjs flushes them once a minute, only when nonzero). */
export function keepoutCounters () {
  return { gather_skipped: 0, gather_refused: 0, gather_cooldown: 0, mine_bearing_refused: 0, mine_walkout: 0, mine_refused: 0,
           mine_step_refused: 0, mine_cooldown: 0, dig_refused: 0, exit_out: 0, exit_failed: 0, yield_town_job: 0, yield_home: 0, disputed: 0 }
}
export function noteKeepout (bot, key, n = 1) {
  try { if (bot) { bot.keepoutStats ??= keepoutCounters(); bot.keepoutStats[key] = (bot.keepoutStats[key] ?? 0) + n } } catch { /* telemetry */ }
}

/**
 * DOES A KEEP-OUT SCOPE STILL HOLD THE BODY? Pure. The route and break vetoes (index.mjs) apply only while the run that set
 * the scope holds the body: a reflex taking it (a drowning rescue, an escape, the scaffold) plans as if keep-out did not exist.
 */
export function scopeHolds (kr, { reflex = null, holder = null, arbiter = true, generation = null, running = true } = {}) {
  if (!kr) return false
  // THE RUN THAT SET IT MUST STILL BE THE RUN (Claude r1 P1-1): production runs with the arbiter OFF (config.mjs), so the
  // holder test alone was always true, and a hard-stopped run's scope -- restored as `prev` by the next run -- vetoed every
  // later walk for the life of the process. The scope carries the runner generation it was set in; any other generation,
  // or no run at all, and the scope is dead.
  if (!running) return false
  if (kr.generation != null && generation != null && kr.generation !== generation) return false
  // eating does not take the body (the skill keeps steering): only a reflex that moves the bot switches the veto off
  if (reflex && !/^eat/.test(String(reflex))) return false
  return !arbiter || holder == null || holder === kr.runSkill
}

/**
 * THE DIG GUARD (index.mjs wraps bot.dig with it, OUTSIDE the `_dig_town` instrument): a TARGET dig (digtown.mjs digPurpose:
 * gather, mine, the ore tunnel's profile) of a cell in a live fire column is refused -- a rejected promise, never sent.
 * Survival, transit, lids and every other skill's digs pass untouched, as does any dig outside every column. Pure factory.
 */
export function keepoutDigGuard (inner, { sitesNow, purposeOf, onRefuse = () => {} } = {}) {
  const guarded = function (block, ...rest) {
    try {
      const p = block?.position
      const sites = p ? (sitesNow?.() ?? []) : []
      const site = sites.length ? columnAt(sites, p) : null
      if (site && purposeOf?.() === 'target') {
        const c = { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) }
        try { onRefuse(site, c) } catch { /* telemetry */ }
        return Promise.reject(Object.assign(new Error(`keepout: ${block.name ?? 'block'} at ${c.x},${c.y},${c.z} is in the column above a marked lava pool (fire death site ${siteKey(site)}); dig ${KEEPOUT_SEARCH}+ blocks from it`), { failClass: 'keepout', keepout: true }))
      }
    } catch { /* the guard must never break a dig it does not refuse */ }
    return inner.call(this, block, ...rest)
  }
  guarded.__keepout = true
  guarded.__digtown = inner?.__digtown
  guarded.__orig = inner?.__orig ?? inner
  return guarded
}

/**
 * THE GUARD'S PURPOSE, with survival first (Codex r1 P2-4): the dig instrument's digPurpose names a pathfinder dig by its
 * movement profile's tag BEFORE it looks at a reflex or a survival scope, so a rescue that runs while gather's tunnel profile
 * is still set would read `target`. The guard asks the survival questions first: a reflex active, another holder of the body,
 * or a `survival` scope (the reflex tick, `_keepout_exit`) -> survival, never refused. Pure.
 */
export function guardPurpose ({ reflex = null, holder = null, skill = null, scope = null, base = 'other' } = {}) {
  // eating does not take the body (Codex r2 P1-3): a work dig while the bot eats is still the work's dig
  if (reflex && !/^eat/.test(String(reflex))) return 'survival'
  if (holder && skill && holder !== skill) return 'survival'
  if (scope?.purpose === 'survival') return 'survival'
  return base
}
