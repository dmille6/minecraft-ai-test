// SHOP-01, THE WORKSHOP JOB'S POLICY (stage C; design docs/reports/building-tier-2026-10-23.md sections 4-5, cooperation A2/A7/A9).
// Pure: the switch, the town order, the bill, spendableFor, the footprint price, the pool's stood cells, the rows. The skill
// (skills.mjs build_shop) supplies readings and effects; the visit itself is buildrun.mjs.

import fs from 'node:fs'
import path from 'node:path'
import { reserveKeyOf, reserveCount, takeAllowed, LOG_NAMES, PLANKS_OF } from './mats.mjs'
import { monumentOn, MONUMENT_PLOT, MONUMENT_BLUEPRINT, MONUMENT_BUILDERS } from './ziggurat.mjs'
import { pathsOn, PATHS_PLOT, PATHS_BLUEPRINT, PATHS_BUILDERS } from './paths.mjs'
import { wallOn, WALL_PLOT, WALL_BLUEPRINT, WALL_BUILDERS } from './wall.mjs'

/** SHOP=off is the rollback; anything else runs the job (the variant's code is the change). */
export const SHOP = Object.freeze({ on: process.env.SHOP !== 'off' })
export const SHOP_BLUEPRINT = 'workshop@1'
export const SHOP_PLOT = 'shop'
/**
 * HOUSE-01: THE TOWN'S PROJECTS, IN ORDER (owner backlog 10-29: house-01 after the workshop). The build_shop job builds ONE
 * project at a time: the first whose record is not complete, or a complete one that is damaged (repaired first, in order).
 * HOUSE=off is the rollback: the workshop alone, exactly as before. A house is house@1 (5x5 shell on a 7x7 pad, an OPEN 1x2
 * doorway like the workshop's -- owner Q2: real doors only after a Paper-proven door change -- so no sealed interior, no
 * exit_house). Each project is its own record chain (`project-<home>.<plot>`): leases, slots, shares and the progress clock are
 * per project; the footprint price, the keep-outs and the sapling boxes cover EVERY project's record.
 */
export const HOUSE = Object.freeze({ on: !['off', '0', 'false', 'no'].includes(String(process.env.HOUSE ?? '').trim().toLowerCase()) })
/**
 * MONUMENT-01: THE ZIGGURAT is the third project (ziggurat.mjs; OWNER 10-29 "top priority" on the showcase): after the workshop,
 * built ALONGSIDE the house -- a bot whose first open project has no free admission slot works the next one (activeProject's
 * `free`) -- with its own builders (MONUMENT_BUILDERS) and its own visit (skills.mjs buildMonument). On in the showcase pool,
 * off in the fleet's until its rollout (ziggurat.mjs monumentOn; MONUMENT=off is the rollback).
 */
export const MONUMENT = Object.freeze({ on: monumentOn(process.env, process.env.MEMORY_POOL ?? '') })
/**
 * PATHS-01: THE TOWN'S PATHS are the fourth project (paths.mjs; owner showcase list 10-29: house-01 -> paths-01 -> wall-01): after
 * the house, laid from the core to every complete project's front, the farm and the well. On in the showcase pool, off in the
 * fleet's until its rollout (paths.mjs pathsOn; PATHS=off is the rollback).
 */
export const PATHS = Object.freeze({ on: pathsOn(process.env, process.env.MEMORY_POOL ?? '') })
/**
 * WALL-01: THE TOWN WALL is the fifth project (wall.mjs; owner showcase list 10-29: house-01 -> paths-01 -> wall-01): after the
 * paths (its gateways are where they cross), a cobblestone rampart round the plan area. On in the showcase pool, off in the fleet's
 * until its rollout (wall.mjs wallOn; WALL=off is the rollback). It needs the paths (and the house) on.
 */
export const TOWNWALL = Object.freeze({ on: wallOn(process.env, process.env.MEMORY_POOL ?? '') })
export const PROJECTS = Object.freeze([
  Object.freeze({ plot: SHOP_PLOT, blueprint: SHOP_BLUEPRINT }),
  Object.freeze({ plot: 'house1', blueprint: 'house@1', after: SHOP_PLOT }),
  Object.freeze({ plot: MONUMENT_PLOT, blueprint: MONUMENT_BLUEPRINT, after: SHOP_PLOT, builders: MONUMENT_BUILDERS }),
  Object.freeze({ plot: PATHS_PLOT, blueprint: PATHS_BLUEPRINT, after: 'house1', builders: PATHS_BUILDERS }),
  Object.freeze({ plot: WALL_PLOT, blueprint: WALL_BLUEPRINT, after: PATHS_PLOT, builders: WALL_BUILDERS }),
])
export const projectsOn = (on = HOUSE.on, mon = MONUMENT.on, paths = PATHS.on, wall = TOWNWALL.on) => PROJECTS.filter(p => p.plot === SHOP_PLOT || (p.plot === MONUMENT_PLOT ? mon : p.plot === PATHS_PLOT ? paths && on : p.plot === WALL_PLOT ? wall && paths && on : on))
/** A project's admission slots (the workshop's and a house's BUILDERS_MAX). Pure. */
export const buildersOf = p => p?.builders ?? BUILDERS_MAX
/**
 * THE PROJECT THE JOB WORKS ON NOW -> a PROJECTS entry. Pure. `states` [{ plot, exists, complete, damaged, free?, due? }] in PROJECTS
 * order (a missing state reads as no record). The first damaged complete project (repairs first), else the first not complete
 * whose `after` project is complete -- monument-01: the first such with an admission slot free for this bot (`free`, absent =
 * free), else the first such -- else the LAST project (everything stands: the order reads it complete and stays quiet).
 */
export function activeProject (states = [], list = projectsOn()) {
  const st = p => states.find(s => s?.plot === p.plot) ?? { plot: p.plot, exists: false, complete: false, damaged: false }
  for (const p of list) { const s = st(p); if (s.exists && s.complete && s.damaged) return p }
  const open = []
  for (const p of list) {
    const s = st(p)
    if (s.exists && s.complete) continue
    if (p.after && !st(list.find(q => q.plot === p.after) ?? { plot: p.after }).complete) continue
    open.push(p)
  }
  if (open.length) return open.find(p => st(p).free !== false) ?? open[0]
  // wall-01: a complete project that only wants a visit for its upkeep (`due`: the ziggurat's tidy) after every open one
  for (const p of list) { const s = st(p); if (s.exists && s.complete && s.due) return p }
  return list[list.length - 1]
}
/**
 * A REPAIR THAT DOES NOT TAKE WAITS (wall-01, LIVE showcase 10-30 07:21Z on: a path cell under a block someone set on it read as
 * damage the paths' visit cannot mend -- `clears_wait`, nothing done -- and, repairs coming first, every bot's build order went to
 * it while the wall stood open). A project this bot has visited as a REPAIR REPAIR_TRIES times within REPAIR_WINDOW_MS and that
 * still reads damaged is taken as only `due` (after every open project) until the window ends; then it is a repair again. Pure.
 *   mem   Map plot -> { n, first } (the bot's own, for the connection)
 */
export const REPAIR_TRIES = 3
/**
 * THE TIDY AFTER A REPAIR (zigtidy-02, LIVE showcase 10-30: no tidy row from 07:16Z on -- since wall-01 r3 a finished ziggurat's
 * tidy was only `due`, after every open project, and the paths stood open all day at 261/263 `clears_wait`; the voidfill repair's
 * climbs left ten pillars by 22:30Z). For TIDY_AFTER_REPAIR_MS after the record's last REPAIR COMPLETION (a visit that placed and
 * ended complete; `repairedAt`, a town file) the tidy is a REPAIR (first), still bounded per bot by ZIG_TIDY_VISITS a pillar and
 * by repairBackoff; after it, `due` as before. A stamp more than a minute in the future (a bad clock) opens nothing. Pure.
 */
export const TIDY_AFTER_REPAIR_MS = 2 * 60 * 60_000
export const tidyIsRepair = (repairedAt, now = Date.now()) => Number.isFinite(repairedAt) && repairedAt <= now + 60_000 && now - repairedAt < TIDY_AFTER_REPAIR_MS
/** A COMPLETE record's stuck stamp is STALE when every cell it names is a record cell that reads done now (`cellDone(cell)`: the
 *  caller's world read; unread is not done). zigtidy-02 (buildproj.mjs stuckAt `stale`). Pure. */
export function stuckStale (keys = [], record = null, cellDone = () => false) {
  const byKey = new Map((record?.cells ?? []).map(c => [c.at.join(','), c]))
  return keys.every(k => { const c = byKey.get(k); return !!c && cellDone(c) === true })
}
/** An OPEN record's stuck stamp is STALE when the record has other work: an open cell (`cellOpen(cell) === true`: the caller's world
 *  read, read and not done; unread is not open) in a segment none of the stamp's cells is in -- the stamp was written when nothing
 *  else was open (buildrun.mjs settleStuck `stalled`), so the 6-h back-off holds only the stuck segment, never the rest of the
 *  project (wallstuck-01, LIVE showcase 10-30 23:17Z: Gale's stamp on W-03 held W-01's two open cells too). A light cell is never
 *  "other work" (its torch is the material run's). Pure. */
export function stuckOtherWork (keys = [], record = null, cellOpen = () => false) {
  const byKey = new Map((record?.cells ?? []).map(c => [c.at.join(','), c]))
  const segs = new Set(keys.map(k => byKey.get(k)?.seg).filter(Boolean))
  if (!segs.size) return false
  return (record?.cells ?? []).some(c => c.role !== 'light' && !segs.has(c.seg) && cellOpen(c) === true)
}
export const REPAIR_WINDOW_MS = 60 * 60_000
export function repairBackoff (states = [], mem = null, now = Date.now()) {
  if (!mem) return states
  return states.map(st => {
    const e = st?.damaged ? mem.get(st.plot) : null
    return e && e.n >= REPAIR_TRIES && now - e.first < REPAIR_WINDOW_MS ? { ...st, damaged: false, due: true } : st
  })
}
/** A visit starting on `pick` as a repair (its state damaged) is counted (a window older than REPAIR_WINDOW_MS starts again). Pure
 *  over `mem` (mutated). */
export function noteRepair (mem, pick, states = [], now = Date.now()) {
  if (!mem || !pick) return
  const st = states.find(x => x?.plot === pick.plot)
  if (!st?.damaged) return
  const e = mem.get(pick.plot)
  mem.set(pick.plot, e && now - e.first < REPAIR_WINDOW_MS ? { n: e.n + 1, first: e.first } : { n: 1, first: now })
}
/**
 * A STUCK PROJECT WAITS BEHIND THE OTHERS (stuckwait-01, LIVE showcase 10-30 10:24Z on: the ziggurat's repair hit two cells no
 * stand reached -- a sealed void an escape dug in its core -- and its F4 back-off (any builder's stuck_on_cell holds the ORDER for
 * SHOP_STUCK_RETRY_MS) held EVERY bot's build_shop for 6 h, because the stuck ziggurat stayed the active project (repairs first)
 * while the wall stood open at 198 of 941). A project whose stuck stamp is inside the back-off is taken as only `due` when complete
 * (after every open project, as repairBackoff does) and as not `free` when open (the next open project first); with nothing else
 * to work, activeProject still returns it and the order's back-off holds as before. Pure.
 *   stuckOf  plot -> the project's stuck stamp ms | null (buildproj.mjs stuckAt); a throw reads as none
 */
export function stuckBackoff (states = [], stuckOf = null, now = Date.now()) {
  if (typeof stuckOf !== 'function') return states
  return states.map(st => {
    if (!st?.exists) return st
    let sa = null
    try { sa = stuckOf(st.plot) } catch { sa = null }
    if (!(Number.isFinite(sa) && sa <= now + 60_000 && now - sa < SHOP_STUCK_RETRY_MS)) return st
    return st.complete ? { ...st, damaged: false, due: true, stuck: true } : { ...st, free: false, stuck: true }
  })
}
/** THE OTHER PROJECTS' RECORDS AS SITING ZONES -> [{ box: [x0,y0,z0,x1,y1,z1] }]: each record's x/z box widened by `margin`
 *  (a walk lane between buildings and the stand ring), every height. Pure. */
export const PROJECT_GAP = 3
export function recordZones (records = [], margin = PROJECT_GAP) {
  const out = []
  for (const r of records) {
    // paths-01: a record that names its own zones (the paths: their columns + 1; a box would be the whole town)
    if (Array.isArray(r?.zones)) { for (const z of r.zones) if (Array.isArray(z?.box) && z.box.length === 6 && z.box.every(Number.isFinite)) out.push(z); continue }
    const b = r?.box
    if (!Array.isArray(b) || b.length !== 4 || !b.every(Number.isFinite)) continue
    out.push({ box: [b[0] - margin, -64, b[1] - margin, b[2] + margin, 320, b[3] + margin], why: `project:${r.plot ?? '?'}` })
  }
  return out
}
export const BUILDERS_MAX = 2
export const SHOP_COOLDOWN_MS = Number(process.env.SHOP_COOLDOWN_MS) > 0 ? Number(process.env.SHOP_COOLDOWN_MS) : 10 * 60_000   // a setting (sandbox pacing)
export const SHOP_SITE_RETRY_MS = 24 * 60 * 60_000       // S1: no site -> re-fit daily
export const SHOP_STUCK_RETRY_MS = 6 * 60 * 60_000       // F4: a cell no stand reached in STUCK_VISITS visits -> ask again in 6 h
export const SHOP_HEALTH_MIN = 10
export const SHOP_BAG_SLOTS_MIN = 8                      // the bill rides in the bag: at least this many free slots
export const MONUMENT_BAG_SLOTS_MIN = 2                  // monument-01: the ziggurat is built mostly from the cobble a bag already holds
/** The projects a bag needs only MONUMENT_BAG_SLOTS_MIN free slots for (paths-01: a shovel's use draws nothing). */
/** wall-01: the wall is built from the cobblestone the bags carry, as the ziggurat is. */
export const LIGHT_PLOTS = Object.freeze(new Set([MONUMENT_PLOT, PATHS_PLOT, WALL_PLOT]))
/** THE ACTIVE PROJECT'S PLOT for an order with no record yet (skills.mjs installs shopActive's: an unsited project's bag rule). */
let activePlotOf = () => null
export function setActivePlot (fn) { if (typeof fn === 'function') activePlotOf = fn }
export const SHOP_BILL_CAP = 4 * 64                      // at most this many blocks drawn per visit
export const SHOP_VISIT_MS = 8 * 60_000
// the walks a footprint is priced on (design 4.4 scope, Codex r1 P2): WORK and TRAVEL. The escape and reflex walks (ascend,
// descend, water) keep their survival digs: damage is rebuilt on the next visit
export const FOOTPRINT_PROFILES = Object.freeze(new Set(['walk', 'gather', 'tunnel', 'composter_walk', 'town_deposit_walk']))
export const TOWN_R = 16

/** THE FOOTPRINT -> Set "x,y,z" of every record cell + 1 (a 3x3x3 around each). Pure. */
export function footprintCells (record) {
  const out = new Set()
  for (const c of record?.cells ?? []) for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) out.add(`${c.at[0] + dx},${c.at[1] + dy},${c.at[2] + dz}`)
  return out
}
/**
 * NO SAPLING IN A PROJECT'S COLUMNS (fell-01, LIVE 10-27 showcase: a spruce stood in shop pad cell 25,72,28 with its trunk up
 * through the wall cells; the builder could never place there). A tree grows UP and its leaves spread ~2 blocks, so the guard
 * is the record cells' x/z box widened by SAPLING_MARGIN, at every height. -> { x0, z0, x1, z1 } | null (no record). Pure.
 */
export const SAPLING_MARGIN = 2
export function saplingBox (record, margin = SAPLING_MARGIN) {
  const cs = record?.cells ?? []
  if (!cs.length) return null
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity
  for (const c of cs) { x0 = Math.min(x0, c.at[0]); x1 = Math.max(x1, c.at[0]); z0 = Math.min(z0, c.at[2]); z1 = Math.max(z1, c.at[2]) }
  return { x0: x0 - margin, z0: z0 - margin, x1: x1 + margin, z1: z1 + margin }
}
/** The project's OPEN-or-built record cells as "x,y,z" keys (the place skill's keep-out; shopwalls-05). Pure. */
export const recordCellKeys = record => new Set((record?.cells ?? []).map(c => c.at.join(',')))
/** A place() candidate ({ ref, face }) whose target cell (ref + face) is a record cell? Pure. LIVE showcase 10-28 16:33Z: an
 *  idle `place crafting_table` put the table into the workshop's last open roof cell 24,75,31; every visit then read
 *  `blocked: 1 open, 0 placeable now`. */
export const recordCellHit = (cells, c) => { const p = c?.ref?.position; return !!(p && cells?.size && cells.has(`${p.x + (c.face?.x ?? 0)},${p.y + (c.face?.y ?? 0)},${p.z + (c.face?.z ?? 0)}`)) }
/** May a sapling go into the cell at column (x, z)? false inside the box -- or inside any box of a list (house-01: one per
 *  project record). Pure. */
export const saplingAllowedAt = (box, x, z) => (Array.isArray(box) ? box.every(b => saplingAllowedAt(b, x, z)) : box?.cols ? !box.cols.has(`${x},${z}`) : (!box || x < box.x0 || x > box.x1 || z < box.z0 || z > box.z1))
/** A place() candidate ({ ref, face }) for a sapling: its target cell (ref + face) outside the box? Pure. */
export const saplingCandidateOk = (box, c) => { const p = c?.ref?.position; return !p || saplingAllowedAt(box, p.x + (c.face?.x ?? 0), p.z + (c.face?.z ?? 0)) }
/** The footprint's price for a block on the current walk: 100 (mineflayer-pathfinder drops the move) on a work or travel walk,
 *  else 0. One Set lookup (the A* hot path). Pure. */
export const footprintCost = (cells, profile, block) => {
  const p = block?.position
  if (!p || !cells || !FOOTPRINT_PROFILES.has(profile)) return 0
  const k = `${p.x},${p.y},${p.z}`
  if (cells.size && cells.has(k)) return 100
  // MONUMENT-01 (`cells.solidOnly`: the ziggurat's record cells, no halo): priced while the cell holds a SOLID block, judged at the
  // check itself (Codex r6 BLOCK 1: a built-cells set refreshed every 60 s left a cell built since unpriced). So a walk never breaks
  // a built cell, and an OPEN one takes the pathfinder's scaffold -- LIVE showcase 10-29 16:00-16:40Z: 19 `_reflex_stuck` in the
  // foundation's hollows, builders who could neither break the canopy in the +1 halo nor pillar out of their own open cell.
  if (cells.solidOnly?.has?.(k) && block.boundingBox === 'block') return 100
  // ZIGTIDY-02 (`cells.soft`: a COMPLETE ziggurat's tread tops, ziggurat.mjs zigTreadTops): a walk's scaffold there is PRICED, not
  // forbidden -- LIVE showcase 10-30 16:45-22:30Z: ten dirt pillars on the finished treads, the walks to the top climbing each
  // 2-high tier wall by a 1x1 tower beside it instead of taking the grand stair. A bot with no other way still climbs
  return cells.soft?.get?.(k) ?? 0
}
/** The pathfinder entry for the footprint (one fn for exclusionAreasBreak and exclusionAreasPlace), TAGGED so an escape clone can
 *  drop it. `cells()` / `profile()` are read at search time. */
export function footprintEntry (cells, profile) {
  const f = block => footprintCost(cells(), profile(), block)
  f.shopFootprint = true
  return f
}
/**
 * AN ESCAPE CLONE CARRIES NO FOOTPRINT PRICE (W3 one-trunk merge, Codex P1): the price read the ACTIVE profile, so a probe
 * searched on the ascend/descend/water/deck Movements while the active profile was still `walk` (skills.mjs surface) was
 * vetoed on workshop cells, and the climb could fall back to a shaft that fails. Bound to the Movements object instead,
 * as nobridge-01 r2 did: the clone's own arrays without the tagged entries. Mutates and returns `m`.
 */
export function withoutFootprint (m) {
  if (!m) return m
  for (const k of ['exclusionAreasBreak', 'exclusionAreasPlace']) if (Array.isArray(m[k])) m[k] = m[k].filter(f => !f?.shopFootprint)
  return m
}

/**
 * THE BILL of the open cells -> { name: n }. Pure. `has(name)` is the bag; the first palette choice, a fallback only when the
 * first is not in the town (`inTown(name)`); '$planks' resolves to `planks` (the town's most-stocked species).
 */
export function billOf (record, palette, read, { done, inTown = () => true, planks = 'oak_planks' } = {}) {
  const out = {}
  for (const c of record?.cells ?? []) {
    if (done(read(...c.at), palette, c.role)) continue
    const name = c.role === 'fill' ? 'cobblestone' : resolve(palette, c.role, inTown, planks)
    if (name) out[name] = (out[name] ?? 0) + 1
  }
  return out
}
/** A role's names in palette order ('$planks' -> the planks species, '$role' -> that role's names, once each). Pure. */
export function roleNames (palette, role, planks = 'oak_planks', seen = new Set([role])) {
  const out = []
  for (const choice of palette?.[role] ?? []) {
    if (choice === '*solid') continue                       // a done-rule (buildrun.mjs SOLID_ANY), not a block
    if (choice === '$planks') out.push(planks)
    else if (choice.startsWith('$')) { const r = choice.slice(1); if (!seen.has(r)) { seen.add(r); out.push(...roleNames(palette, r, planks, seen)) } } else out.push(choice)
  }
  return [...new Set(out)]
}
/** The block a bill counts for a role: the first of its names the town stocks, else its first name. Pure. */
function resolve (palette, role, inTown, planks) {
  const names = roleNames(palette, role, planks)
  return names.find(n => inTown(n)) ?? names[0] ?? null
}
/**
 * THE PROJECT'S SHARE OF THE BAG (Paper 10-25, SHOP-KILL and CHAIN-1: a deadlock) -> { name: n }: the drawn record clamped to
 * what the bag holds now. Pure. Why: the visit's keeps (towndeposit townKeeps: STOCKPILE_KEEP wood, the stone family) are
 * computed from the bag at the visit's start, so materials an EARLIER visit drew and did not place (a kill, a deps_open stop, a
 * no_material stop: matsBank cannot bank a kept name back) became the bag's own stockpile -- held, unspendable, and the town
 * already at BUILD_RESERVE: the builder held 36 planks and stopped `no_material` on one wall cell for 40 minutes.
 */
export function drawnHeld (drawn = {}, held = {}, bagAt = null) {
  // a DECREASE of the bag since the record was written (another job spent some: the peaceful kit's composter) comes off the
  // project's share first, so the bot's own stock is never relabelled the project's (r10, Codex P2); with no baseline, the
  // clamp to the bag alone. An increase (a pickup) is the bot's own.
  const out = {}
  for (const [n, c] of Object.entries(drawn ?? {})) {
    const fell = bagAt && Number.isFinite(Number(bagAt[n])) ? Math.max(0, Number(bagAt[n]) - (Number(held?.[n]) || 0)) : 0
    const v = Math.min((Number(c) || 0) - fell, Number(held?.[n]) || 0)
    if (v > 0) out[n] = v
  }
  return out
}
/** How long a share outlives its last write (a visit, or the decrease below) before it is the bag's own: a builder that has not
 *  visited for this long holds no workshop materials (r16 reviews, both P2: a share that never empties barred the bot from
 *  every town station for good). A live build rewrites its share at every take, placement and exit. */
export const SHARE_TTL_MS = 2 * 3600_000
/**
 * THE SHARE'S STATE for the town-station gate (skills.mjs shopShareHeld) -> { held: bool, share, write: null | {} | share }.
 * Pure. Not held when: no share; written longer than SHARE_TTL_MS ago; or the workshop is COMPLETE and the share is no newer
 * than the completion (another builder finished: a completed build's leftovers are the bag's own -- `write: {}` clears it).
 * A share the bag has fallen below (another job spent some) is RETIRED down to what is left (`write: share`), so a later
 * pickup of the same name is the bot's own and never resurrects it (r16 Codex P2: drawn 4, baseline 20, bag 16 then 20).
 */
export function shareState (dr = {}, held = {}, { now = Date.now(), complete = false, completeAt = null, ttl = SHARE_TTL_MS } = {}) {
  const drawn = dr?.drawn ?? {}
  if (!Object.keys(drawn).length) return { held: false, share: {}, write: null }
  const at = Number(dr?.at)
  // a complete record WITHOUT its completion time is no boundary (r17 Codex P2): the share stands until its TTL
  if (complete && Number.isFinite(Number(completeAt)) && !(at > Number(completeAt))) return { held: false, share: {}, write: {} }
  if (!Number.isFinite(at) || now - at > ttl) return { held: false, share: {}, write: null }
  const share = drawnHeld(drawn, held, dr?.bag)
  const fell = Object.keys(drawn).some(n => (share[n] ?? 0) < (Number(drawn[n]) || 0))
  return { held: Object.keys(share).length > 0, share, write: fell ? share : null }
}
/** The bag less the project's share -> { name: n }: what the bot owns, the only counts its keeps are computed from. Pure. */
export function ownCounts (held = {}, drawn = {}) {
  const out = {}
  for (const [n, c] of Object.entries(held ?? {})) { const v = (Number(c) || 0) - (Number(drawn?.[n]) || 0); if (v > 0) out[n] = v }
  return out
}
/** The drawn record after a visit -> { name: n }: drawn + took + crafted - placed - back, never below 0 nor above the bag. Pure. */
export function drawnAfter ({ drawn = {}, took = {}, crafted = {}, placed = {}, back = {}, bag1 = {} } = {}) {
  const names = new Set([drawn, took, crafted, placed, back].flatMap(m => Object.keys(m ?? {})))
  const n = (m, k) => Number(m?.[k]) || 0
  const out = {}
  for (const k of names) { const v = Math.min(n(bag1, k), n(drawn, k) + n(took, k) + n(crafted, k) - n(placed, k) - n(back, k)); if (v > 0) out[k] = v }
  return out
}
/** What the visit still needs from town -> { name: n }: the bill less the bag, capped at SHOP_BILL_CAP in all. Pure. */
export function needFromTown (bill, bag = {}, cap = SHOP_BILL_CAP) {
  const out = {}
  let left = cap
  for (const [n, c] of Object.entries(bill).sort((a, b) => b[1] - a[1])) {
    const want = Math.max(0, c - (Number(bag[n]) || 0))
    const take = Math.min(want, left)
    if (take > 0) { out[n] = take; left -= take }
  }
  return out
}
/**
 * PLANKS FROM THE TOWN'S LOGS (shopwalls-1028; LIVE showcase 10-28 11:50Z on: pad and ring done, then every visit stopped
 * `no_material why=wall_for_wall-F` for hours -- the town held 0 planks and 412 spruce logs, the bill asked for `oak_planks`,
 * the withdraw found none, and nothing crafted planks for a project: the mats job has no planks kind). -> { log, logs, planks }
 * | null. Pure. `want` is the visit's needs, `spare(name)` what the bag holds above its keeps AFTER the town draw, `town` the
 * indexed stock. The shortfall is every *_planks the needs name (any species: a '$planks' cell takes any) less the bag's spare
 * planks of every species; it is drawn as whole logs (1 log -> 4 planks) of the town's most-stocked log species. The town's
 * reserve is not judged here: the withdraw's own `allow` (the project reserve) caps what is taken.
 */
/** IS A NAME "IN TOWN" FOR THE BILL'S PALETTE CHOICE -> (name) => bool. Pure. Its stock, or -- for planks -- any log in town (the
 *  visit crafts them: planksFromLogs). Without the second half a trim cell (['cut_copper', '$planks']) in a town of logs and no
 *  planks resolved to cut_copper, which the town cannot supply: its planks were never drawn and the trim stopped no_material. */
export const billInTown = (town = {}) => {
  const logs = LOG_NAMES.some(n => (Number(town?.[n]) || 0) > 0)
  return n => (Number(town?.[n]) || 0) > 0 || (/_planks$/.test(n) && logs)
}
export function planksFromLogs (want = {}, { spare = () => 0, town = {} } = {}) {
  const wanted = Object.entries(want ?? {}).filter(([n]) => /_planks$/.test(n)).reduce((t, [, c]) => t + (Number(c) || 0), 0)
  if (wanted <= 0) return null
  const held = Object.values(PLANKS_OF).reduce((t, n) => t + Math.max(0, Number(spare(n)) || 0), 0)
  const short = wanted - held
  if (short <= 0) return null
  let log = null
  for (const n of LOG_NAMES) { const c = Number(town?.[n]) || 0; if (c > 0 && (!log || c > (Number(town[log]) || 0))) log = n }
  if (!log) return null
  const logs = Math.ceil(short / 4)
  return { log, logs, planks: PLANKS_OF[log] }
}
/**
 * WHAT A VISIT DRAWS -> { name: n } (r2): the open cells' bill; a sapling for every pending replant whose cell holds none (Codex r1
 * P2: C1's remedy made executable -- the town's saplings come with the bill); and the inputs of a station the town cannot supply
 * (8 cobblestone a furnace, 4 planks a table: Claude r1 P3-4, the craft never eats the fill). Pure.
 */
export function visitNeeds (record, bill, { saplingAt = () => false, town = {}, spare = {}, planks = 'oak_planks' } = {}) {
  const out = { ...bill }
  for (const r of record?.replant ?? []) if (r?.sapling && r.state !== 'skipped' && !saplingAt(r.cell)) out[r.sapling] = (out[r.sapling] ?? 0) + 1
  for (const [item, input, n] of [['furnace', 'cobblestone', 8], ['crafting_table', planks, 4]]) {
    const lack = (Number(bill[item]) || 0) - (Number(spare[item]) || 0)
    if (lack > 0 && (Number(town[item]) || 0) < lack) out[input] = (out[input] ?? 0) + n * lack
  }
  return out
}
/** THE LEFTOVERS -> [name]: what the visit drew (`took`) that the bag still holds ABOVE its count at the visit's start (`held0`),
 *  so never anything the bot owned before the visit or kept (matsBank then banks at most `took` of each, above `held0`). Pure. */
export function leftoverNames (took = {}, held0 = {}, heldNow = {}) {
  return Object.keys(took).filter(n => (Number(took[n]) || 0) > 0 && (Number(heldNow[n]) || 0) > (Number(held0[n]) || 0))
}
/**
 * THE VISIT'S BAG BALANCE (read r1: Codex P1-2, Claude P3-4) -> { name: { bag0, took, crafted, placed, back, bag1, unexplained } }
 * for every name the visit touched. Pure. unexplained = bag1 - (bag0 + took + crafted - placed - back): NEGATIVE is a loss the visit
 * cannot account for (a pickup on the way makes it positive; the pathfinder's scaffold of cobblestone or planks makes it
 * negative and is legitimate for those two -- SCAFFOLD_NAMES -- so the read gates only the other names).
 */
export function bagBalance ({ bag0 = {}, took = {}, crafted = {}, placed = {}, back = {}, bag1 = {} } = {}) {
  const names = new Set([...Object.keys(took), ...Object.keys(crafted), ...Object.keys(placed), ...Object.keys(back)])
  const out = {}
  const n = (m, k) => Number(m?.[k]) || 0
  for (const k of names) {
    const v = { bag0: n(bag0, k), took: n(took, k), crafted: n(crafted, k), placed: n(placed, k), back: n(back, k), bag1: n(bag1, k) }
    v.unexplained = v.bag1 - (v.bag0 + v.took + v.crafted - v.placed - v.back)
    out[k] = v
  }
  return out
}
export const SCAFFOLD_NAMES = Object.freeze(new Set(['cobblestone', 'oak_planks', 'spruce_planks', 'birch_planks', 'jungle_planks', 'acacia_planks', 'dark_oak_planks', 'mangrove_planks', 'cherry_planks', 'pale_oak_planks', 'bamboo_planks', 'crimson_planks', 'warped_planks']))
/** `_build_bag` detail: `project=shop name=bag0/took/crafted/placed/back/bag1 ...` (under 300 characters: names by unexplained first). */
export const buildBagDetail = (project, bal, { exit = '-', silent = '-', drawn = '-' } = {}) => {
  const parts = Object.entries(bal).sort((a, b) => a[1].unexplained - b[1].unexplained).map(([k, v]) => `${k}=${v.bag0}/${v.took}/${v.crafted}/${v.placed}/${v.back}/${v.bag1}`)
  let s = `project=${project} exit=${String(exit).replace(/\s+/g, '_').slice(0, 24)} silent=${silent} drawn=${drawn}`
  for (const p of parts) { if ((s + ' ' + p).length > 290) break; s += ' ' + p }
  return s
}
/** The skill's contract time (skills.mjs build_shop maxMs) and the least left for a bank to start (Claude r3 P3-1). */
export const SHOP_SKILL_MS = 600_000
export const SHOP_BANK_MIN_MS = 150_000
/**
 * HOW MUCH OF A NAME THE VISIT MAY TAKE from the container it stands at (matsWithdraw's `allow`) -> n. Pure. A reserved family
 * is mats.mjs takeAllowed (the BUILD_RESERVE and the outstanding draws, judged at the take); a building PART has no reserve
 * (Paper r1: takeAllowed answers 0 for a name with no reserve key, so stone bricks, panes, cut copper, stations and saplings
 * were never drawn) and is taken up to what the container shows.
 */
export function shopAllow (name, want, o = {}) {
  if (reserveKeyOf(name)) return takeAllowed(name, want, o)
  return Math.max(0, Math.min(Number(want) || 0, Number(o?.here?.[name]) || 0))
}
/**
 * SPENDABLE FOR A PROJECT (cooperation A9) -> n. Pure. The town's stock of `item` less its BUILD_RESERVE (by reserve family, the
 * whole family's stock above the family's reserve: mats.mjs reserveCount) less every OTHER claim on it (draws in flight, other
 * projects' claims: `claims` { name: n }), never below 0. A building part (no reserve key) is all of its stock less claims.
 */
export function spendableFor (item, stock = {}, { reserve = {}, claims = {} } = {}) {   // reserve: mats.mjs matsReserve().table (its one reader)
  const rk = reserveKeyOf(item)
  const own = Number(stock[item]) || 0
  const claimed = Number(claims[item]) || 0
  if (!rk) return Math.max(0, own - claimed)
  const famAbove = Math.max(0, reserveCount(rk, stock) - (Number(reserve?.[rk]) || 0))
  return Math.max(0, Math.min(own, famAbove) - claimed)
}

/**
 * THE TOWN ORDER (host part of buildEligible, design 4.1/A8) -> { order, skip }. Pure. At town only, shared towns only, no
 * milestone holding, after the cooldown; the record complete is no order; S1 (no site) waits a day; a full slot set, low health,
 * or a bag without room is a skip with its reason.
 */
export function buildOrder ({ on = SHOP.on, shared = true, atTown = false, holds = false, now = 0, state = {}, record = null,
  complete = false, slotsFree = true, health = 20, freeSlots = 36, planned = true, stuckAt = null } = {}) {
  if (!on || !shared || !atTown || holds) return { order: null, skip: null }
  // no town plan yet: nothing to site a workshop in, and no order (it would only displace the model's turn)
  if (!planned) return { order: null, skip: null }
  if (complete) return { order: null, skip: 'complete' }
  if (now - (state.lastAt ?? -Infinity) < SHOP_COOLDOWN_MS) return { order: null, skip: null }
  if (!record && state.lastStop === 'no_site' && now - (state.lastAt ?? -Infinity) < SHOP_SITE_RETRY_MS) return { order: null, skip: 'no_site' }
  // F4 back-off: the PROJECT's (`stuckAt`, the stuck files: across restarts and bots -- Claude r21 P3-3), or this bot's own stop.
  // `stuckAt` may be a function, read only here, past the cheap skips (Claude r22 P3); a stamp more than a minute in the FUTURE
  // (a skewed or bad clock) is ignored rather than holding the project skew + 6 h
  const sa = typeof stuckAt === 'function' ? stuckAt(now) : stuckAt
  if (Number.isFinite(sa) && sa <= now + 60_000 && now - sa < SHOP_STUCK_RETRY_MS) return { order: null, skip: 'stuck_on_cell' }
  if (state.lastStop === 'stuck_on_cell' && now - (state.lastAt ?? -Infinity) < SHOP_STUCK_RETRY_MS) return { order: null, skip: 'stuck_on_cell' }
  if (!slotsFree) return { order: null, skip: 'slots_full' }
  if (health <= SHOP_HEALTH_MIN) return { order: null, skip: 'health' }
  let plot = record?.plot ?? null
  if (!record) { try { plot = activePlotOf() } catch { plot = null } }
  if (freeSlots < (LIGHT_PLOTS.has(plot) ? MONUMENT_BAG_SLOTS_MIN : SHOP_BAG_SLOTS_MIN)) return { order: null, skip: 'room' }
  return { order: { skill: 'build_shop', args: {} }, skip: null }
}

// ---- the pool's stood cells (D3 at runtime: step 1's carried item) ------------------------------------------------------------

export const STOOD_MAX_LINES = 20_000
export const STOOD_EVERY_MS = 30_000
export const STOOD_REPEAT_MS = 10 * 60_000
const stoodFile = (dir, key) => path.join(dir, `${key}.stood.jsonl`)
/** Append one in-town feet cell (the caller rate-limits). Rotates at STOOD_MAX_LINES (the old file kept as .old). Never throws. */
export function stoodAppend (dir, key, cell, { now = Date.now(), by = null } = {}) {
  try {
    fs.mkdirSync(dir, { recursive: true })
    const f = stoodFile(dir, key)
    let lines = 0
    try { lines = fs.readFileSync(f, 'utf8').split('\n').length } catch { /* none yet */ }
    if (lines >= STOOD_MAX_LINES) { try { fs.renameSync(f, `${f}.old`) } catch { /* another rotated it */ } }
    fs.appendFileSync(f, JSON.stringify({ c: cell, at: now, by }) + '\n')
  } catch { /* telemetry-grade: the walk falls back to home's cell */ }
}
/** The pool's distinct stood cells inside the town circle of `home` -> [[x, y, z]] (both files, torn lines skipped). Pure over
 *  the files. */
export function stoodRead (dir, key, home) {
  const seen = new Set(), out = []
  for (const f of [`${stoodFile(dir, key)}.old`, stoodFile(dir, key)]) {
    let text = ''
    try { text = fs.readFileSync(f, 'utf8') } catch { continue }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      let r
      try { r = JSON.parse(line) } catch { continue }
      const c = r?.c
      if (!Array.isArray(c) || c.length !== 3 || !c.every(Number.isInteger)) continue
      if (Math.max(Math.abs(c[0] - home.x), Math.abs(c[2] - home.z)) > TOWN_R) continue
      const k = c.join(',')
      if (!seen.has(k)) { seen.add(k); out.push(c) }
    }
  }
  return out
}

// ---- rows (detail strings only: no new ES fields -- an unmapped field rejects whole documents, town plan 4.2) -------------------

const LONG = new Set(['why', 'segs'])   // `segs`: a whole workshop's segment list is ~72 chars (Codex/Claude r26 P3)
const fmt = (keys, f) => keys.filter(k => f[k] != null).map(k => `${k}=${String(Array.isArray(f[k]) ? f[k].join(',') : f[k]).replace(/\s+/g, '_').slice(0, LONG.has(k) ? 120 : 48)}`).join(' ')
export const buildModeDetail = (reserveSha = '-') => `phase=mode v=1 shop=${SHOP.on ? 'on' : 'off'} blueprints=${projectsOn().map(p => p.blueprint).join(',')} builders_max=${BUILDERS_MAX} reserve=${reserveSha}`
// EVERY FIELD A ROW CARRIES THAT THE READ READS (Paper 10-26 SHOP-TERRAIN seeded r24: the whitelist dropped the F2/F4 fields --
// `to`, `result`, `visits`, `n`, `segs`, `waiting`, `stalled`, `early`, `why` -- so the stuck row reached the logs as
// `op=stuck_on_cell cell=...` and the read's STALLED POOLS could never see a stall; the fake runner's e.log kept the objects)
export const buildRowDetail = f => fmt(['project', 'op', 'seg', 'cell', 'block', 'kind', 'saplings', 'gen', 'to', 'result', 'visits', 'n', 'segs', 'waiting', 'stalled', 'early', 'why'], f)
export const buildSegDetail = f => fmt(['project', 'seg', 'open', 'done', 'material_open', 'found_done', 'found_open', 'why'], f)
export const buildVisitDetail = f => fmt(['project', 'outcome', 'stop', 'placed', 'refused', 'silent', 'cleared', 'planted', 'unknown', 'slot', 'gen', 'took', 'back', 'ms', 'why'], f)
