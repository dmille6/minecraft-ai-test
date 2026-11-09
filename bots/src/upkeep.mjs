// UPKEEP-01 (OWNER 11-09 "i want all of those things done": the UPKEEP CREW -- a standing maintenance loop: repair damaged blocks on
// finished records, replant felled trees and saplings, re-light dark lamps, sweep strays (tables, furnaces, dropped items), re-till
// farmland; the LOWEST-priority, always-available work, so no bot is idle; its jobs on the town work board).
// Design: docs/reports/country-design-2026-11-09.md section D (Claude + Codex engines, independent, reconciled).
//
// MEASURED (showcase snapshot 11-09 12:10Z, ~9,800 cells on 17 finished records; 12 h of rows to 12:35Z):
//   repair   decor 7 fern cells, monument 8 core, storehub 4 -- ALREADY the picker's first tier (shop.mjs activeProject: a damaged complete
//            record is a repair; skills.mjs recordDamaged), so upkeep never duplicates it: it COUNTS them (`repair`)
//   relight  0 of 60 record light cells dark -- a lost torch on a record is damage, so a repair too; COUNTED (`relight`)
//   retill   10 of 10 farm cells farmland -- the crop farm's own upkeep (cropfarm.mjs cropDue, prodserve first); COUNTED (`retill`)
//   NEW: strays -- crafting tables and furnaces standing on the ground outside every record: 53 + 15 inside the wall ring, 63 tables and
//        98 furnaces in 28-128; remains -- log groups no member of which rests on the ground (a tree felled at its base): 39 inside,
//        ~100 a ring out to 128 (a column count); dropped items -- the crew's sweep (gksweep.mjs) reaches only inside the walls.
//   Bot time: 167.9 bot-h in 12 h, build visits 10.6 h (6.3%); ~100 bot-h between skills (the 11-08 measure: patrol rung 51.8%).
//
// THE MODEL. A town's upkeep is a project plot `upkeep` (PROJECTS, last) whose record is a JOB LIST: each survey (a visit finding the
// list stale, UPKEEP.surveyMs) publishes a new generation listing what is wrong NOW within UPKEEP.r of home -- the strays and the
// remains as `clear` entries (kind stray / remains), one sapling a remains group as a `cells` entry (role `sapling`: the felled tree
// replanted at its own stump's soil) -- and the visit (buildrun.mjs runVisit, the ordinary record machinery) works it; then the bot
// sweeps the drops in view (gksweep.mjs sweepPick over the upkeep reach). The tripwire judges it as a sink (shopread SINK_PLOTS:
// placements on a cell, digs on the clear list, of a generation in force). The ORDER takes it last: after every repair, open project,
// due upkeep and sink (shop.mjs activeProject: `upkeep` plots), and instead of a project this bot cannot work (no slot, marked idle).
// On the work board (townwork.mjs jobBlocked) it is a job exactly while it is due: { exists, complete, due, free }.
// UPKEEP=off is the rollback (no plot, no order, nothing sited; a sited record is never visited again).
//
// PURE: the switch, the knobs, the survey over a `read(x, y, z)`, the record, the state, the rows. Nothing here touches a bot.

import { isLiquid, replaceableCell } from './townplan.mjs'

const k3 = a => `${a[0]},${a[1]},${a[2]}`
const nm = b => String(b?.name ?? '').replace(/\[.*\]$/, '')
const AIR = /^(air|cave_air|void_air)$/
const LOG = /_(log|wood)$/
const LEAVES = /_leaves$/
const SOIL = /^(grass_block|dirt|podzol|coarse_dirt|rooted_dirt|moss_block|mycelium)$/
export const STRAY = /^(crafting_table|furnace|blast_furnace|smoker)$/
export const SAPLING_OF = Object.freeze({ oak_log: 'oak_sapling', birch_log: 'birch_sapling', spruce_log: 'spruce_sapling', jungle_log: 'jungle_sapling', acacia_log: 'acacia_sapling', dark_oak_log: 'oak_sapling', cherry_log: 'cherry_sapling', pale_oak_log: 'oak_sapling', mangrove_log: 'mangrove_propagule' })

export const UPKEEP_PLOT = 'upkeep'
export const UPKEEP_BLUEPRINT = 'upkeep@1'
/** THE SWITCH -> bool. UPKEEP=off|0|false|no -> no upkeep plot; UPKEEP=on -> on; unset: every NAMED pool (as the groundskeeper's:
 *  a test bot or a scratch run keeps the order as before). Pure. */
export function upkeepOn (env = process.env, pool = '') {
  const v = String(env?.UPKEEP ?? '').trim().toLowerCase()
  if (v === 'off' || v === '0' || v === 'false' || v === 'no') return false
  if (v === 'on' || v === '1' || v === 'true') return true
  return !!String(pool ?? '').trim()
}

export const UPKEEP = Object.freeze({
  r: 128,                    // the survey's reach (Chebyshev from home): the countryside's outer band (country.mjs COUNTRY.r)
  dy: 14,                    // the surface band round home.y the survey reads
  surveyMs: 30 * 60_000,     // a job list older than this is surveyed again (the visit that finds it stale)
  quietMs: 2 * 60 * 60_000,  // a survey that found nothing: the next one after this long
  jobMax: 48,                // clears a generation lists at most (nearest first)
  remainsMax: 24,            // logs a remains group may have (larger: a living tree's crown a read missed -- never listed)
  reachUp: 6,                // a remains group's highest log at most this far over its ground (a bot on the ground reaches it)
  strayEdge: 3,              // a stray within this many columns of a record box is a building's station (never listed)
  air: 6,                    // clear cells above a replant's soil (tidy.mjs REPLANT_AIR)
  builders: 4,               // admission slots on the plot
  segCells: 12,              // cells a segment
})
/** The record's palette: the replant takes the sapling of the felled tree's own kind first. */
export const UPKEEP_PALETTE = Object.freeze({ sapling: ['spruce_sapling', 'oak_sapling', 'birch_sapling', 'dark_oak_sapling', 'jungle_sapling', 'acacia_sapling', 'cherry_sapling'] })

/** A column's ground y under (x, z) from yHi down: the first full block that is not a log, leaves or a stray. null: liquid/unread. Pure. */
function groundY (read, x, z, yHi, yLo) {
  for (let y = yHi; y >= yLo; y--) {
    const b = read(x, y, z)
    if (!b) return null
    const n = nm(b)
    if (AIR.test(n) || LEAVES.test(n) || LOG.test(n) || STRAY.test(n) || b.boundingBox === 'empty' || replaceableCell(b) || n === 'snow') continue
    if (isLiquid(b)) return null
    return y
  }
  return null
}

/**
 * THE REMAINS -> [{ logs: [[x, y, z]], base: [x, y, z], name }]. Pure over `read`. Every 6-connected group of logs within the box whose
 * NO member rests on the ground (the block under each member is air, leaves, a plant, a liquid or another log of the group) -- a tree
 * felled at its base leaves exactly this; a living tree always stands on its trunk. A group larger than UPKEEP.remainsMax, one touching
 * the box edge (it may go on beyond: unread), or one with an unread neighbour is never listed (fail closed). `base`: the cell under the
 * group's lowest log, down to the ground. `bounds` [x0, z0, x1, z1]: the reach a group may not touch (default the box); `seen`: shared
 * between the tiles of one survey (a group is found once). A group whose top log stands more than UPKEEP.reachUp over its ground is
 * never listed (`high`: no stand on the ground reaches it).
 */
export function remainsIn (read, box, { yHi, yLo, bounds = box, seen = new Set(), skipped = {}, U = UPKEEP } = {}) {
  const [x0, z0, x1, z1] = bounds
  const out = []
  const isLog = (x, y, z) => { const b = read(x, y, z); return !!b && LOG.test(nm(b)) }
  for (let x = box[0]; x <= box[2]; x++) for (let z = box[1]; z <= box[3]; z++) for (let y = yHi; y >= yLo; y--) {
    const k = `${x},${y},${z}`
    if (seen.has(k) || !isLog(x, y, z)) continue
    // the group (flood over the six faces)
    const grp = [], q = [[x, y, z]], mine = new Set([k])
    seen.add(k)
    let bad = false
    while (q.length) {
      const [a, b, c] = q.pop()
      grp.push([a, b, c])
      if (grp.length > U.remainsMax) { bad = true; break }
      if (a <= x0 || a >= x1 || c <= z0 || c >= z1 || b >= yHi || b <= yLo) { bad = true; break }
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const p = [a + dx, b + dy, c + dz], pk = k3(p)
        if (mine.has(pk)) continue
        const blk = read(...p)
        if (!blk) { bad = true; break }
        if (LOG.test(nm(blk))) { mine.add(pk); seen.add(pk); q.push(p) }
      }
      if (bad) break
    }
    if (bad) { for (const m of mine) seen.add(m); continue }
    // grounded: any member whose block below is not air, leaves, a plant, a liquid or a member of the group
    const grounded = grp.some(([a, b, c]) => {
      if (mine.has(`${a},${b - 1},${c}`)) return false
      const u = read(a, b - 1, c)
      if (!u) return true   // unread below: fail closed (read as grounded: never listed)
      const n = nm(u)
      return !(AIR.test(n) || LEAVES.test(n) || u.boundingBox === 'empty' || replaceableCell(u) || isLiquid(u))
    })
    if (grounded) continue
    const low = grp.reduce((m, p) => (p[1] < m[1] ? p : m), grp[0])
    const gy = groundY(read, low[0], low[2], low[1] - 1, yLo)
    const topY = Math.max(...grp.map(p => p[1]))
    if (gy == null || topY - gy > U.reachUp) { skipped.remains_high = (skipped.remains_high ?? 0) + 1; continue }
    out.push({ logs: grp.sort((p, r) => r[1] - p[1] || p[0] - r[0] || p[2] - r[2]), base: gy == null ? null : [low[0], gy, low[2]], name: nm(read(...low)) })
  }
  return out
}

/**
 * THE STRAYS -> [{ at, name }]. Pure over `read`. A crafting table, furnace, smoker or blast furnace standing on the ground (the block
 * under it is the column's ground or another stray) in the box, never a record cell, never within UPKEEP.strayEdge of a record's box
 * or a refusal (`avoid`: a building's own station, the yard, the farm), never in a protected zone (`zone`).
 */
export function straysIn (read, box, { yHi, yLo, cells = new Set(), avoid = () => null, zone = () => false, U = UPKEEP } = {}) {
  const [x0, z0, x1, z1] = box
  const out = []
  const near = (x, z) => { for (let dx = -U.strayEdge; dx <= U.strayEdge; dx++) for (let dz = -U.strayEdge; dz <= U.strayEdge; dz++) if (avoid(x + dx, z + dz)) return true; return false }
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
    for (let y = yHi; y >= yLo; y--) {
      const b = read(x, y, z)
      if (!b) break
      const n = nm(b)
      if (!STRAY.test(n)) { if (!(AIR.test(n) || LEAVES.test(n) || b.boundingBox === 'empty' || replaceableCell(b))) break; continue }
      if (cells.has(`${x},${y},${z}`) || zone(x, y, z) || near(x, z)) break
      out.push({ at: [x, y, z], name: n })
      break
    }
  }
  return out
}

/**
 * THE SURVEY -> { clear, cells, census }. Pure over `read`.
 *   home, r       the reach
 *   cells         Set 'x,y,z' every record cell (and the grounds' plans: never a job)
 *   avoid(x, z)   the refusals (zones, record boxes + margin, wells, the farm) -> reason | null
 *   zone(x, y, z) a protected zone's cell
 *   counts        { repair, relight, retill } -- the jobs other code owns, counted for the row only
 * Clears: the strays (kind stray) and every log of each remains group (kind remains, `group` its index), nearest the home first, at
 * most UPKEEP.jobMax; cells: one sapling a remains group at the soil under it (its own kind first in the palette order), when the soil
 * is soil, the cell open and UPKEEP.air clear above, never on a record cell or a refused column.
 */
export function upkeepSurvey (read, { home, r = UPKEEP.r, box = null, cells = new Set(), avoid = () => null, zone = () => false, counts = {}, U = UPKEEP } = {}) {
  const bounds = [home.x - r, home.z - r, home.x + r, home.z + r]
  box ??= bounds
  const yHi = home.y + U.dy, yLo = home.y - U.dy
  const census = { strays: 0, remains: 0, remainLogs: 0, replants: 0, repair: Number(counts.repair) || 0, relight: Number(counts.relight) || 0, retill: Number(counts.retill) || 0, skipped: {} }
  const skip = why => { census.skipped[why] = (census.skipped[why] ?? 0) + 1 }
  const d = a => Math.max(Math.abs(a[0] - home.x), Math.abs(a[2] - home.z))
  const strays = straysIn(read, box, { yHi, yLo, cells, avoid, zone, U })
  const groups = remainsIn(read, box, { yHi, yLo, bounds, skipped: census.skipped, U }).filter(g => {
    if (g.logs.some(p => cells.has(k3(p)) || zone(...p))) { skip('remains_guarded'); return false }
    if (g.logs.some(p => avoid(p[0], p[2]))) { skip('remains_refused'); return false }
    return true
  })
  const jobs = [
    ...strays.map(s => ({ dist: d(s.at), clears: [{ at: s.at, kind: 'stray', name: s.name }], cell: null })),
    ...groups.map(g => ({ dist: d(g.logs[0]), clears: g.logs.map(at => ({ at, kind: 'remains', name: nm(read(...at)) })), cell: g.base, name: g.name })),
  ].sort((a, b) => a.dist - b.dist)
  const clear = [], plant = []
  let gi = 0
  for (const j of jobs) {
    if (clear.length + j.clears.length > U.jobMax) { skip('job_cap'); continue }
    const isRemains = j.clears[0].kind === 'remains'
    const grp = isRemains ? gi++ : null
    for (const c of j.clears) clear.push(grp == null ? c : { ...c, group: grp })
    if (isRemains) { census.remains++; census.remainLogs += j.clears.length } else census.strays++
    if (!isRemains || !j.cell) continue
    const [x, y, z] = j.cell, at = [x, y + 1, z]
    const soil = read(x, y, z), up = read(...at)
    if (!soil || !SOIL.test(nm(soil))) { skip('replant_no_soil'); continue }
    if (!up || !(AIR.test(nm(up)) || replaceableCell(up)) || isLiquid(up)) { skip('replant_covered'); continue }
    if (cells.has(k3(at)) || avoid(x, z) || zone(...at)) { skip('replant_refused'); continue }
    let room = true
    // the remains' own logs above count as room: they are this job's clears
    const own = new Set(j.clears.map(c => k3(c.at)))
    for (let dy = 2; dy <= U.air && room; dy++) { const b = read(x, y + dy, z); const n = nm(b); if (!b || !(AIR.test(n) || LEAVES.test(n) || own.has(`${x},${y + dy},${z}`) || replaceableCell(b))) room = false }
    if (!room) { skip('replant_no_room'); continue }
    plant.push({ at, role: 'sapling', group: grp, sapling: SAPLING_OF[j.name] ?? null })
    census.replants++
  }
  return { clear, cells: plant, census }
}

/**
 * A SURVEY AS THE PLOT'S NEXT GENERATION -> record. Pure. The job list (clears; the replants as cells in segments of UPKEEP.segCells),
 * `surveyedAt`, the census; complete at once when it lists nothing (the next survey after UPKEEP.quietMs).
 */
export function upkeepRecord (sv, { home, now = Date.now(), by = '?', tile = 0, quietRun = 0, U = UPKEEP } = {}) {
  const cells = [], segments = []
  ;(sv?.cells ?? []).forEach((c, i) => {
    const seg = `U-${Math.floor(i / U.segCells)}`
    if (!segments.some(s => s.seg === seg)) segments.push({ seg, deps: [] })
    cells.push({ at: c.at, role: c.role, seg, group: c.group, ...(c.sapling ? { sapling: c.sapling } : {}) })
  })
  const clear = (sv?.clear ?? []).map(c => ({ ...c }))
  const empty = !clear.length && !cells.length
  return {
    v: 1, blueprint: UPKEEP_BLUEPRINT, plot: UPKEEP_PLOT, kind: 'upkeep', home: home ? { x: home.x, y: home.y, z: home.z } : null,
    cells, clear, segments, replant: [], zones: [], palette: UPKEEP_PALETTE, builders_max: U.builders,
    structure_complete: empty, state: empty ? 'quiet' : 'open', ...(empty ? { completeAt: now } : {}),
    surveyedAt: now, sitedAt: now, sitedBy: by, census: sv?.census ?? null, tile, quietRun,
  }
}
/** THE TILES a survey covers one at a time (an eighth of the reach each): tile i -> [x0, z0, x1, z1]. Pure. */
export const UPKEEP_TILES = 8
export function upkeepTile (home, i, r = UPKEEP.r) {
  // the reach's quadrants, each split in two along x: a survey reads an eighth of the reach (~240k cells at r 128)
  const t = ((Number(i) || 0) % UPKEEP_TILES + UPKEEP_TILES) % UPKEEP_TILES
  const q = t >> 1, half = t & 1
  const xs = q & 1 ? [home.x + 1, home.x + r] : [home.x - r, home.x]
  const zs = q & 2 ? [home.z + 1, home.z + r] : [home.z - r, home.z]
  const mid = Math.floor((xs[0] + xs[1]) / 2)
  return half ? [mid + 1, zs[0], xs[1], zs[1]] : [xs[0], zs[0], mid, zs[1]]
}
/** The next survey's tile and quiet run from the head (`rec`) and whether the survey found jobs. Pure. */
export const upkeepNextTile = rec => (Number.isFinite(Number(rec?.tile)) ? (Number(rec.tile) + 1) % UPKEEP_TILES : 0)
export const upkeepQuietRun = (rec, empty) => (empty ? (Number(rec?.quietRun) || 0) + 1 : 0)
/** Is the job list due its re-survey? A list older than surveyMs; a quiet (empty) one after quietMs. Unknown time: due. Pure. */
export function upkeepStale (rec, now = Date.now(), U = UPKEEP) {
  if (!rec) return true
  const at = Number(rec.surveyedAt ?? rec.sitedAt)
  if (!Number.isFinite(at) || at > now + 60_000) return true
  // a quiet list waits quietMs only once every tile has come back quiet in a row (`quietRun`); else the next tile after surveyMs
  return now - at >= (rec.structure_complete && rec.state === 'quiet' && (Number(rec.quietRun) || 0) >= UPKEEP_TILES ? U.quietMs : U.surveyMs)
}
/**
 * THE PLOT'S STATE FOR THE ORDER -> { plot, exists, complete, damaged, due, upkeep }. Pure. Always "complete" (never in the finite
 * order, never a repair), DUE while a job is open (`open(rec)`: the caller's world read) or the list is stale (the visit surveys);
 * or while drops worth a sweep lie in view (dropsWorth); otherwise quiet (not due: the work board reads it `complete`, the order passes it).
 */
export function upkeepState (rec, { now = Date.now(), open = () => 0, drops = 0, U = UPKEEP } = {}) {
  const stale = upkeepStale(rec, now, U)
  const left = rec && !rec.structure_complete ? Number(open(rec)) || 0 : 0
  const d = Number(drops) || 0
  return { plot: UPKEEP_PLOT, exists: true, complete: true, damaged: false, due: stale || left > 0 || d > 0, dueFirst: false, upkeep: true, stale, left, drops: d }
}
// ---- CODEX r1 BLOCKERS 1-3: the replant's obligation, a grown replant, the drops ------------------------------------------------
/** A replant cell DONE: a sapling stands in it, or a log (it grew: never a foreign block to dig). Pure over the cell's block. */
export const replantDone = b => !!b && (/_sapling$|^mangrove_propagule$/.test(nm(b)) || LOG.test(nm(b)))
/**
 * THE REPLANT GATE (Codex r1 BLOCKER 2, r2 BLOCKERS 1-2) -> { workable, held, retired, owe }: Sets of remains group indices. Pure over
 * `read`. A group that owes a replant (a `sapling` cell) is taken down only AFTER its own sapling stands in its replant cell -- the
 * replant first, then the logs -- so the obligation can never be lost (no sapling, an interrupted visit, one sapling for two groups:
 * the unplanted groups' logs stand, and the next survey of the tile lists them again). Its replant cell reads:
 *   a sapling   -> WORKABLE (its logs may be dug)
 *   a log       -> RETIRED (the replant grew: its logs, if any stand where the remains were, are the new tree -- never dug)
 *   else        -> HELD (unplanted, or unread)
 * A group that owes nothing (no soil, no room under it) is workable.
 */
export function replantGate (rec, read) {
  const owe = new Map()
  for (const c of rec?.cells ?? []) if (c?.role === 'sapling' && Number.isFinite(c.group)) owe.set(c.group, c)
  const workable = new Set(), held = new Set(), retired = new Set()
  for (const c of rec?.clear ?? []) {
    if (c?.kind !== 'remains' || !Number.isFinite(c.group)) continue
    const cell = owe.get(c.group)
    if (!cell) { workable.add(c.group); continue }
    const b = read(...cell.at)
    if (b && LOG.test(nm(b))) retired.add(c.group)
    else if (b && /_sapling$|^mangrove_propagule$/.test(nm(b))) workable.add(c.group)
    else held.add(c.group)
  }
  return { workable, held, retired, owe: new Set(owe.keys()) }
}
/**
 * THE JOBS A VISIT MAY TAKE NOW -> { plant, clear, held, retired }. Pure over `read`. `plant`: the record with the replants not done
 * (planted first); `clear`: the record with the strays and the remains of the WORKABLE groups (replantGate) -- read again after the
 * planting, so a group planted in this visit is taken down in it.
 */
export function upkeepVisitJobs (rec, read) {
  if (!rec) return { plant: null, clear: null, held: 0, retired: 0 }
  const g = replantGate(rec, read)
  const plant = { ...rec, clear: [], cells: (rec.cells ?? []).filter(c => c.role === 'sapling' && !replantDone(read(...c.at))) }
  const clearList = (rec.clear ?? []).filter(c => c.kind !== 'remains' || !Number.isFinite(c.group) || g.workable.has(c.group))
  return { plant, clear: { ...rec, cells: [], clear: clearList }, held: [...g.held].length, retired: [...g.retired].length }
}
/**
 * THE JOBS LEFT ON A LIST -> n. Pure over `read`. A stray still standing as its listed block; a workable group's log still standing;
 * a replant not done and its held group's logs -- these two only when this bot can plant (`canPlant`: it or the town holds a sapling;
 * else they are not its work now and never make the upkeep due for it). A retired group (its replant grew) leaves nothing. Unread: left.
 */
export function upkeepLeft (rec, read, { canPlant = true } = {}) {
  if (!rec || rec.structure_complete) return 0
  const g = replantGate(rec, read)
  const standing = c => { const b = read(...c.at); return !b || nm(b) === c.name }
  let n = 0
  for (const c of rec.clear ?? []) {
    if (c.kind === 'remains' && Number.isFinite(c.group)) {
      if (g.retired.has(c.group)) continue
      if (g.held.has(c.group) && !canPlant) continue
    }
    if (standing(c)) n++
  }
  if (canPlant) for (const c of rec.cells ?? []) { const b = read(...c.at); if (!b || !replantDone(b)) n++ }
  return n
}
/** One `_upkeep` row's detail. Pure. */
export const upkeepDetail = f => Object.entries(f).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}=${String(Array.isArray(v) ? v.join(',') : typeof v === 'object' ? Object.entries(v).map(([a, b]) => `${a}:${b}`).join(',') : v).replace(/\s+/g, '_').slice(0, 120)}`).join(' ')
