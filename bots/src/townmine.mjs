// THE TOWN MINE (townmine-01; OWNER 11-09 "a proper town mine": a lit, stepped main shaft from town down to diamond level with rest
// landings every 10-15 steps, a chest and a crafting/smelting nook at the bottom, branch tunnels at the iron and diamond levels,
// torches, water and lava sealed -- never bridged; bots mine there instead of digging random holes). Design:
// docs/reports/townmine-design-2026-11-09.md (Codex and a Claude subagent proposed independently; reconciled there).
//
// WHAT IT IS. The town stair (shaft-02, shaftgeom.mjs) EXTENDED: its record gains `ext` and planStair continues the same spiral
// below the 16 landing to feet MINE_BOTTOM_FEET (-53, owner O6) with rest bays every 12 steps and a hall off the bottom step
// (shaftgeom.mjs mineRooms). This module adds what is not the stair: the two GALLERIES (fishbone strip mines, a spine with side
// branches every GALLERY.every cells, two high) -- the iron one from the 16 landing's stub end face, the diamond one from the
// hall's far wall -- the routes the deep miner walks, the siting check against zones and other records, the switch, the rows.
//
// WHO WORKS IT. The town's deep miner (deepmine.mjs; one per town, owner O13): a 'build' trip digs the deep stair, its bays, the
// hall and places the hall's fixtures and torches (the 180 s skill cap makes a round trip to -53 impossible inside one call;
// only the deep miner's trip state machine stays underground between calls); iron and diamond trips walk the stair to a gallery
// and dig its next slot cell by cell (probe ahead, seal, torch), mining the ore they open, then walk the gallery and the stair back.
//
// MEASURED (baseline 11-09): the deep miner's iron branches started INSIDE the 16 landing's stub (deepBranch from where the bot
// stood) and dug nothing: fleet 3 d 2,030 `stair_cells` + 748 `void` with 0 cells, iron trips 0.24 iron each; showcase since
// 11-06 0 iron in 42 trips. A gallery starts at the stub's END FACE, which the stair never reserves.
//
// Pure: no bot, no world. KILL SWITCH: TOWNMINE=off (or TOWNMINE_POOLS not naming the pool): no siting, no build trips, no
// galleries -- the deep miner exactly as before.

import { planOf, isStairRecord, standOf, isOpen, isFull, isWet, isLava, STAIR_BOTTOM_FEET, MINE_BLUEPRINT, toWorld, goodSolid } from './shaftgeom.mjs'

// ---- the switch -----------------------------------------------------------------------------------------------------------------
export const TOWNMINE_DEFAULT_POOLS = 'showcase'   // the showcase first (owner 11-09); the fleet port flips this to '*'
export function townMineOn (env = process.env, pool = '') {
  const v = String(env?.TOWNMINE ?? '').trim().toLowerCase()
  if (v === 'off' || v === '0' || v === 'false' || v === 'no') return false
  if (v === 'on' || v === '1' || v === 'true') return true
  const pools = String(env?.TOWNMINE_POOLS ?? TOWNMINE_DEFAULT_POOLS).split(',').map(q => q.trim()).filter(Boolean)
  return pools.includes('*') || pools.includes(String(pool))
}
export const TOWNMINE = Object.freeze({ on: townMineOn(typeof process !== 'undefined' ? process.env : {}, typeof process !== 'undefined' ? (process.env.MEMORY_POOL ?? '') : '') })

// ---- the numbers ----------------------------------------------------------------------------------------------------------------
export const GALLERY = Object.freeze({ spine: 24, every: 3, branch: 12, torchEvery: 6 })
export const BUILD_USES = 90               // pickaxe uses a build trip starts with (a deep step is 3 digs + lining; ~25 steps a trip)
export const BUILD_UNITS_CALL = 40         // units one build call may do (shaftvisit UNITS_MAX)
export const BUILD_COOLDOWN_MS = 3 * 60_000   // between build trips that cut something (the ore trips' 20 min is for ore)
export const FIXTURE_ITEMS = Object.freeze(['chest', 'crafting_table', 'furnace'])

// ---- the record -----------------------------------------------------------------------------------------------------------------
/** Is this a stair record with a town mine on it? Pure. */
export const hasMine = rec => isStairRecord(rec) && rec.ext?.blueprint === MINE_BLUEPRINT
/** THE MINE NOW -> { sited, complete, stopped, why }. Pure. */
export function mineState (rec) {
  if (!hasMine(rec)) return { sited: false, complete: false, stopped: false, why: 'no_mine' }
  const st = rec.ext.state
  if (st === 'no_site' || !Number.isInteger(rec.ext.Kb)) return { sited: false, complete: false, stopped: false, why: 'no_site' }
  return { sited: true, complete: st === 'complete', stopped: st === 'stopped', why: st }
}
/** MAY A MINE BE SITED ON THIS STAIR? -> null (yes) | why. Pure. The stair complete with its 16 landing built, no mine yet. */
export function mineSiteRefusal (rec) {
  if (!isStairRecord(rec)) return 'no_stair'
  if (hasMine(rec)) return 'sited'
  if (!rec.structure_complete) return 'stair_unfinished'
  if (!(rec.landings_built ?? []).includes(STAIR_BOTTOM_FEET)) return 'no_bottom_landing'
  if (!Array.isArray(rec.exit)) return 'no_exit'
  return null
}
/**
 * THE EXTENSION'S CELLS CHECKED AGAINST WHAT THE TOWN KEEPS -> { ok, why, at }. Pure. `plan` = the extended plan (planOf with ext);
 * `forbid(x, y, z)` -> a reason (a protected zone, another record's cell or box) or null. Only the NEW cells are asked (the stair
 * above the 16 landing is already sited). A forbidden cell refuses the whole extension: a stair cannot step round a zone.
 */
export function mineSiteCheck (plan, forbid = () => null, { oldKeys = new Set() } = {}) {
  for (const c of plan.cells) {
    const k = c.at.join(',')
    if (oldKeys.has(k)) continue
    const why = forbid(c.at[0], c.at[1], c.at[2])
    if (why) return { ok: false, why: String(why), at: c.at }
  }
  return { ok: true, why: null, at: null }
}
/** The record with its mine sited (cells and box from the extended plan). Pure. */
export function withMine (rec, ext) {
  const r = { ...rec, ext }
  const plan = planOf(r)
  return { ...r, cells: plan.cells.map(c => ({ at: c.at, role: c.role })), box: [plan.box.x0, plan.box.z0, plan.box.x1, plan.box.z1] }
}
/** A truncated extension: a liquid the build could not seal at deep step k ends the mine above it (the hall moves up). Pure. */
export function mineStopped (rec, k, { now = 0, why = 'liquid' } = {}) {
  const Kb = k - 1
  // at or above the 16 landing nothing is left of the extension (planStair ignores an ext whose Kb is not below it)
  return withMine(rec, { ...rec.ext, Kb, stopK: k, stopWhy: why, stoppedAt: now, state: Kb <= rec.K ? 'stopped' : rec.ext.state })
}

// ---- the routes -----------------------------------------------------------------------------------------------------------------
/** The stands to the hall, top down: every step's stand, then the hall's columns from the entrance to the far wall's middle. Pure. */
export function hallRoute (plan) {
  const hall = (plan.rooms ?? []).find(r => r.kind === 'hall')
  if (!hall) return null
  const out = []
  for (let k = 0; k <= plan.K; k++) out.push(standOf(plan, k))
  const path = []
  let col = hall.cols.find(c => c.d === hall.cols.reduce((m, q) => Math.max(m, q.d), 0) && c.w === 0)
  const stepStand = standOf(plan, hall.k)
  for (let guard = 0; col && guard <= hall.cols.length; guard++) {
    path.push(col.air[0])
    const s = col.stand
    if (s[0] === stepStand[0] && s[1] === stepStand[1] && s[2] === stepStand[2]) break
    col = hall.cols.find(c => c.air[0][0] === s[0] && c.air[0][1] === s[1] && c.air[0][2] === s[2])
  }
  return [...out, ...path.reverse()]
}
/** THE WHOLE WAY TO THE HALL READS WALKABLE? -> { ok, why }. Pure over read. Every step's air open and dry, every tread solid,
 *  every hall column's feet and head open (the route verified when the walk starts, as landingUsable does for the 16 landing). */
export function hallUsable (read, plan) {
  for (let k = 0; k <= plan.K; k++) {
    const s = plan.steps[k]
    for (const c of s.air) { const b = read(...c); if (!b) return { ok: false, why: `step${k}:unknown` }; if (!isOpen(b)) return { ok: false, why: `step${k}:${isWet(b) ? 'wet' : 'blocked'}` } }
    const t = read(...s.tread)
    if (!t) return { ok: false, why: `step${k}:unknown` }
    if (!goodSolid(t, read(s.tread[0], s.tread[1] - 1, s.tread[2]), false)) return { ok: false, why: `step${k}:tread` }
  }
  const hall = (plan.rooms ?? []).find(r => r.kind === 'hall')
  if (!hall) return { ok: false, why: 'no_hall' }
  for (const col of hall.cols) for (const c of col.air.slice(0, 2)) { const b = read(...c); if (!b) return { ok: false, why: 'hall:unknown' }; if (!isOpen(b)) return { ok: false, why: 'hall:blocked' } }
  return { ok: true, why: null }
}

// ---- the galleries ----------------------------------------------------------------------------------------------------------------
/**
 * A GALLERY -> { level, stand, slots: [{ id, junction, side, cells: [{ feet, head }] }] } | null. Pure. `stand` = where the miner
 * stands before the spine's first cell (the stub's last column, or the hall's far-middle column). The spine runs straight on
 * along `dir`; side branches leave every GALLERY.every spine cells (starting at the 3rd), both sides, GALLERY.branch long --
 * two rock between neighbours, so every block within one of a tunnel is seen. Slot 0 is the spine.
 */
export function galleryOf (plan, level) {
  let stand = null, first = null, dir = null
  if (level === 'iron') {
    const l = plan.landings.find(q => q.feet === STAIR_BOTTOM_FEET)
    if (!l) return null
    const last = l.cols[l.cols.length - 1]
    stand = last.air[0]
    first = l.end[0]
    dir = [first[0] - stand[0], first[2] - stand[2]]
  } else if (level === 'diamond') {
    const hall = (plan.rooms ?? []).find(r => r.kind === 'hall')
    if (!hall?.portal) return null
    const D = hall.cols.reduce((m, q) => Math.max(m, q.d), 0)
    stand = hall.cols.find(c => c.d === D && c.w === 0).air[0]
    first = hall.portal.at
    dir = [first[0] - stand[0], first[2] - stand[2]]
  } else return null
  if (Math.abs(dir[0]) + Math.abs(dir[1]) !== 1) return null
  const perp = [-dir[1], dir[0]]
  const cell = (i, j = 0, s = 0) => { const f = [first[0] + dir[0] * i + perp[0] * j * s, first[1], first[2] + dir[1] * i + perp[1] * j * s]; return { feet: f, head: [f[0], f[1] + 1, f[2]] } }
  const slots = [{ id: 0, junction: -1, side: 0, cells: Array.from({ length: GALLERY.spine }, (_, i) => cell(i)) }]
  for (let s = GALLERY.every - 1; s < GALLERY.spine; s += GALLERY.every) {
    for (const side of [1, -1]) slots.push({ id: slots.length, junction: s, side, cells: Array.from({ length: GALLERY.branch }, (_, j) => cell(s, j + 1, side)) })
  }
  return { level, stand, dir, slots }
}
/** How far a slot is open: the index of its first cell whose feet or head is not open (cells.length: all open). Pure. */
export function slotProgress (read, slot) {
  for (let i = 0; i < slot.cells.length; i++) {
    const { feet, head } = slot.cells[i]
    const a = read(...feet), b = read(...head)
    if (!a || !b || !isOpen(a) || !isOpen(b)) return i
  }
  return slot.cells.length
}
/**
 * THE GALLERY'S NEXT SLOT -> { slot, i, stand } | null (nothing left that is reachable). Pure over read. The side branches whose
 * junction (the spine cell) is open come first, nearest the portal first, then the spine; a slot whose next cell `skip(slot.id)`
 * names (a stop this trip: a liquid, a void, a placed block) is passed over. The stand is the cell before the slot's next cell:
 * the previous cell of the slot, the junction for a branch's first cell, the gallery's stand for the spine's first.
 * `forbid(cell)` -> a reason for a cell the gallery must not open (a protected zone, another record) -- the slot ends before it.
 */
export function galleryNext (read, gal, { skip = () => false, forbid = () => null } = {}) {
  if (!gal) return null
  const spine = gal.slots[0]
  const spineOpen = slotProgress(read, spine)
  const cand = []
  for (const slot of gal.slots.slice(1)) {
    if (slot.junction >= spineOpen || skip(slot.id)) continue
    const i = slotProgress(read, slot)
    if (i >= slot.cells.length) continue
    if (forbid(slot.cells[i].feet) || forbid(slot.cells[i].head)) continue
    cand.push({ slot, i, stand: i > 0 ? slot.cells[i - 1].feet : spine.cells[slot.junction].feet })
  }
  cand.sort((a, b) => a.slot.junction - b.slot.junction || a.slot.id - b.slot.id)
  if (cand.length) return cand[0]
  if (spineOpen < spine.cells.length && !skip(spine.id) && !forbid(spine.cells[spineOpen].feet) && !forbid(spine.cells[spineOpen].head)) {
    return { slot: spine, i: spineOpen, stand: spineOpen > 0 ? spine.cells[spineOpen - 1].feet : gal.stand }
  }
  return null
}
/** The open gallery cells from the portal to `to` (inclusive) along the slot -> the stands to walk. Pure. */
export function galleryWay (gal, slot, i) {
  const spine = gal.slots[0]
  const out = [gal.stand]
  const upto = slot.id === 0 ? i - 1 : slot.junction
  for (let j = 0; j <= upto; j++) out.push(spine.cells[j].feet)
  if (slot.id !== 0) for (let j = 0; j < i; j++) out.push(slot.cells[j].feet)
  return out
}

// ---- the hall's fixtures and the torches ------------------------------------------------------------------------------------------
/** The hall's fixtures not yet standing -> [{ item, at, stand, cleared }]. Pure. cleared = the cell is open (else it is dug first). */
export function fixturesMissing (read, plan) {
  const hall = (plan.rooms ?? []).find(r => r.kind === 'hall')
  if (!hall) return []
  const out = []
  for (const f of hall.fixtures) {
    const b = read(...f.at)
    if (!b) continue
    if (String(b.name).replace(/\[.*\]$/, '') === f.item) continue
    out.push({ ...f, cleared: isOpen(b), wet: isWet(b), lava: isLava(b) })
  }
  return out
}
/**
 * THE TORCHES THE MINE WANTS -> [{ at, support, k }]. Pure. Two a turn on the pillar below the 16 landing (and one a turn above it,
 * the stair's own rule), one in every bay, four in the hall. A torch goes in an air cell against a full support.
 */
export function torchPlan (plan) {
  const out = []
  const pil = (y) => { const w = toWorld(plan.origin, plan.away, 1, 1); return [w.x, y, w.z] }
  for (let k = 8; k <= plan.K; k++) {
    const idx = (plan.s0 + k) % 8
    const want = idx === 5 || (k > (plan.K16 ?? plan.K) && idx === 1)
    if (!want) continue
    const head = plan.steps[k].air[1]
    out.push({ at: head, support: pil(head[1]), k })
  }
  for (const r of plan.rooms ?? []) for (const t of r.torches) out.push({ ...t, k: r.k })
  return out
}
/** The planned torches missing now (the cell open, the support full, no torch there) -> same shape. Pure over read. */
export function torchesMissing (read, plan) {
  return torchPlan(plan).filter(t => {
    const b = read(...t.at), s = read(...t.support)
    return !!b && !!s && isOpen(b) && !/torch$/.test(String(b.name)) && isFull(s)
  })
}

// ---- rows -----------------------------------------------------------------------------------------------------------------------
/** The `_townmine` row's detail. Pure. op = sited | no_site | build | stop | complete | fixture | torch | gallery. */
export function mineRowDetail ({ op = '-', level = '-', why = '-', k = '-', at = null, n = '-', slot = '-', cells = '-', ms = '-' } = {}) {
  return `op=${op} level=${level} why=${why} k=${k} at=${Array.isArray(at) ? at.join(',') : '-'} n=${n} slot=${slot} cells=${cells} ms=${ms}`.slice(0, 300)
}
