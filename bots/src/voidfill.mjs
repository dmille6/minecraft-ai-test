// VOIDFILL-01: A SEALED VOID IN A PROJECT RECORD IS REPAIRED FROM INSIDE (OWNER 10-30, "with the ziggurat, lets do 3").
//
// THE CASE (showcase 10-30 10:24Z on): a walled-in bot's escape dug up through the ziggurat's core (-34..-33, y67..70, z -33)
// and out through two skin cells; the repair bots re-placed the skin and sealed the shaft. Seven record cells were left open
// under a solid cap (y71..74), with no face any stand could see: every visit deferred them (buildrun.mjs F4), the project went
// stuck_on_cell, and the ziggurat waited behind every other project for good. The visit only places from standable, reachable
// spots, and a sealed void has none.
//
// THE REMEDY, for any record (pure here; the actuator is buildrun.mjs runVisit's `p.access`, effects in buildbot.mjs):
//   1. A SHAFT: a column (x, z) of THIS record next to or through the stuck cells, whose top a walk reaches (a walk node standing
//      on its top record cell). The bot digs straight down from that top, through record cells that read DONE (never another
//      record's cell, never a zone: `mayDig`), each drop at most FALL_MAX blocks (no fall damage).
//   2. THE FILL, climbing out: at each height the bot places every open record cell it can see from where it stands (the same
//      stand rule as every placement, buildsite.mjs stepFor, from the one stand it is on), bottom-up (never a cell over an open
//      one in its column), never in its own column; then it jumps and places the column cell under its feet (a pillar step).
//      The column's cells, the dug ones included, are all record cells, so every pillar step places the record's own block and
//      the climb ends where it began: standing on the column's top with every opened cell re-placed.
//   THE WAY OUT IS ALWAYS ITS OWN: nothing is ever placed in the column above the bot (the shaft it dug is its exit, open to the
//   walk it came from), every pillar step needs the cell two above its feet clear, and the bag must hold every block the plan
//   places (plus a spare) before the first dig. No liquid in or beside the shaft, no falling block in it, no unknown read.
// Bounded: at most ACCESS_DIG_MAX digs, ACCESS_TRIES attempts per bot per target set inside ACCESS_RETRY_MS.

import { stepFor, fullCube, refUsable } from './buildsite.mjs'
import { isPassable } from './townplan.mjs'

const k3 = (x, y, z) => `${x},${y},${z}`
const kOf = a => k3(a[0], a[1], a[2])
const nm = b => String(b?.name ?? '').replace(/\[.*\]$/, '')

export const FALL_MAX = 3            // a drop of 3 blocks costs no health (vanilla: damage = distance - 3)
export const ACCESS_DIG_MAX = 8      // the most record cells one plan opens
export const ACCESS_NEAR = 3         // targets: the open record cells within this Chebyshev distance of a stuck cell's column
export const ACCESS_TRIES = 2        // attempts per bot per target set ...
export const ACCESS_RETRY_MS = 2 * 60 * 60_000   // ... inside this window
export const ACCESS_AFTER = 2        // a deferred cell is "stuck" for the access after this many deferring visits (the stuck map)
export const ACCESS_SPARE = 2        // blocks held beyond the plan's own count before the first dig
export const ACCESS_MIN_MS = 90_000  // the visit's time left before an access starts (it is never abandoned half way by a deadline)
const LIQUIDISH = /water|lava|bubble_column|seagrass|kelp/
export const GRAVITY = /^(sand|red_sand|gravel|suspicious_sand|suspicious_gravel|[a-z_]+_concrete_powder|anvil|chipped_anvil|damaged_anvil|pointed_dripstone|scaffolding)$/
const AIR = Object.freeze({ name: 'air', boundingBox: 'empty' })
const solidOf = name => Object.freeze({ name, boundingBox: 'block' })

/** A cell a body passes through (air, a plant): passable and known. */
const open = b => !!b && isPassable(b)
/** A simulated world over `read`: `set(at, block)` writes the overlay. */
export function simWorld (read) {
  const over = new Map()
  const r = (x, y, z) => (over.has(k3(x, y, z)) ? over.get(k3(x, y, z)) : read(x, y, z))
  r.set = (at, b) => over.set(kOf(at), b)
  return r
}

/**
 * ONE COLUMN'S PLAN -> { ok: true, col, top, bottom, digs, steps, need, done, doneStuck, fall } | { ok: false, why }. Pure.
 *   read            the world (null = unknown)
 *   col             [x, z]
 *   topFeet         y of the feet standing on the column's top (a walk node)
 *   depth           how far below the top's feet the descent aims (feet), the fall past it allowed
 *   cellAt(key)     -> THIS record's cell at "x,y,z" | null
 *   isDone(c, read) the visit's completeness test (role palette, alsoDone)
 *   targets         open record cells near the stuck ones; those in the column are pillared, the rest placed from inside
 *   stuck           keys of the cells at least one of which must come out done for the plan to count
 *   mayDig(at)      the caller's veto (another record's cell, a protected zone): false never digs
 *   blockOf(role)   the block the bag places for a role | null
 *   domain(x, z)    the stands' domain (stepFor); default every column
 * steps: { op: 'dig', at, name, feet } (feet before the dig), { op: 'place', at, support, face, feet, block, seg } (from the
 * column at `feet`), { op: 'pillar', at, support, face: [0, 1, 0], feet, block, seg } (jump from `feet`, place `at`, the feet
 * cell). `need`: { block: n }, every block the plan places.
 */
export function planColumn ({ read, col, topFeet, depth, cellAt, isDone, targets = [], stuck = [], mayDig = () => true, blockOf = () => null, domain = () => true, home = { x: 0, y: 0, z: 0 } }) {
  const [x, z] = col
  const T = topFeet
  const W = simWorld(read)
  const cellOf = y => cellAt(k3(x, y, z))
  const topCell = cellOf(T - 1)
  if (!topCell) return { ok: false, why: 'top_not_record' }
  if (!isDone(topCell, read)) return { ok: false, why: 'top_open' }
  if (!open(read(x, T, z)) || !open(read(x, T + 1, z))) return { ok: false, why: 'top_headroom' }
  // ---- the descent: dig the cell underfoot, drop to the next floor ----
  const digs = [], steps = []
  let f = T, fall = 0
  const aim = T - depth
  const landing = from => { let g = from; while (g > from - 64 && open(W(x, g - 1, z))) g--; return W(x, g - 1, z) ? g : null }
  while (f > aim) {
    const below = [x, f - 1, z]
    const b = W(...below)
    if (!b) return { ok: false, why: `unknown ${kOf(below)}` }
    if (!open(b)) {
      const c = cellAt(kOf(below))
      if (!c) return { ok: false, why: `dig_not_record ${kOf(below)}` }
      if (!isDone(c, W)) return { ok: false, why: `dig_open ${kOf(below)}` }
      if (!fullCube(b) || GRAVITY.test(nm(b)) || LIQUIDISH.test(nm(b))) return { ok: false, why: `dig_shape ${kOf(below)}:${nm(b)}` }
      if (!mayDig(below)) return { ok: false, why: `dig_vetoed ${kOf(below)}` }
      if (digs.length >= ACCESS_DIG_MAX) return { ok: false, why: 'dig_max' }
      digs.push(below); steps.push({ op: 'dig', at: below, name: nm(b), feet: f })
      W.set(below, AIR)
    }
    const g = landing(f)
    if (g == null) return { ok: false, why: `unknown below ${k3(x, f, z)}` }
    if (f - g > FALL_MAX) return { ok: false, why: `fall ${f - g} at ${k3(x, f, z)}` }
    fall = Math.max(fall, f - g)
    f = g
  }
  const bottom = f
  if (!digs.length) return { ok: false, why: 'no_dig' }
  // the floor holds; neither the shaft nor its sides carry a liquid, nothing in the span is unread
  const floor = W(x, bottom - 1, z)
  if (!floor || !fullCube(floor) || GRAVITY.test(nm(floor))) return { ok: false, why: `floor ${nm(floor)}` }
  for (let y = bottom - 1; y <= T + 1; y++) {
    for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const b = read(x + dx, y, z + dz)
      if (!b) return { ok: false, why: `unknown ${k3(x + dx, y, z + dz)}` }
      if (LIQUIDISH.test(nm(b))) return { ok: false, why: `liquid ${k3(x + dx, y, z + dz)}` }
    }
  }
  // every column cell the climb places is THIS record's (no stray pillar left in a structure)
  for (let y = bottom; y <= T - 1; y++) {
    const c = cellOf(y)
    if (!c) return { ok: false, why: `column_not_record ${k3(x, y, z)}` }
    if (!blockOf(c.role)) return { ok: false, why: `no_block ${c.role}` }
  }
  // ---- the climb and the fill ----
  const need = {}
  const add = n => { need[n] = (need[n] ?? 0) + 1 }
  const inColumn = c => c.at[0] === x && c.at[2] === z
  const pending = targets.filter(c => !inColumn(c))
  const byCol = new Map()
  for (const c of pending) { const kk = `${c.at[0]},${c.at[2]}`; if (!byCol.has(kk)) byCol.set(kk, []); byCol.get(kk).push(c) }
  // BOTTOM-UP, as every placement of the visit: never a cell over an open record cell in its column
  const underOpen = c => (byCol.get(`${c.at[0]},${c.at[2]}`) ?? []).some(o => o !== c && o.at[1] < c.at[1] && !isDone(o, W))
  for (f = bottom; ; f++) {
    const here = new Map([[`${x},${z}`, [f]]])
    for (let guard = 0; guard < 64; guard++) {
      const cand = pending.filter(c => !isDone(c, W) && open(W(...c.at)) && !underOpen(c) && blockOf(c.role))
        .map(c => ({ c, s: stepFor(W, home, c.at, here, domain) })).filter(o => o.s)
        .sort((a, b) => a.c.at[1] - b.c.at[1])
      if (!cand.length) break
      const { c, s } = cand[0]
      const block = blockOf(c.role)
      steps.push({ op: 'place', at: c.at, support: s.support, face: s.face, feet: f, block, seg: c.seg }); add(block)
      W.set(c.at, solidOf(block))
    }
    if (f >= T) break
    const c = cellOf(f)
    if (!open(W(x, f + 2, z))) return { ok: false, why: `headroom ${k3(x, f + 2, z)}` }
    if (!refUsable(W(x, f - 1, z))) return { ok: false, why: `pillar_support ${k3(x, f - 1, z)}` }
    const block = blockOf(c.role)
    steps.push({ op: 'pillar', at: [x, f, z], support: [x, f - 1, z], face: [0, 1, 0], feet: f, block, seg: c.seg }); add(block)
    W.set([x, f, z], solidOf(block))
  }
  for (const d of digs) if (open(W(...d))) return { ok: false, why: `left_open ${kOf(d)}` }
  const done = [...new Set(targets.filter(c => isDone(c, W)).map(c => kOf(c.at)))]
  const doneStuck = stuck.filter(k => { const c = cellAt(k); return !!c && isDone(c, W) })
  if (!doneStuck.length) return { ok: false, why: 'no_stuck_cell_done' }
  return { ok: true, why: 'ok', col, top: [x, T, z], bottom, digs, steps, need, done, doneStuck, fall }
}

/**
 * THE ACCESS PLAN for a set of stuck cells -> the best planColumn result, or { ok: false, why, tried }. Pure.
 *   record      the visit's record ({ cells })
 *   stuck       the stuck cells' keys ("x,y,z"): open, no stand reaches them
 *   nodes       the walk's nodes (Map "x,z" -> [feet y]): a column's top must be one
 *   the rest as planColumn (read, isDone, mayDig, blockOf, domain, home)
 * Columns tried: every record column within ACCESS_NEAR of a stuck cell; every top a walk node stands on; every depth to the dig
 * bound. Best: the most stuck cells done, then the most targets done, then the fewest digs, then the shortest fall.
 */
export function planVoidAccess ({ read, record, stuck = [], nodes = new Map(), isDone, mayDig = () => true, blockOf = () => null, domain = () => true, home = { x: 0, y: 0, z: 0 } }) {
  const cellMap = new Map(record.cells.map(c => [kOf(c.at), c]))
  const cellAt = k => cellMap.get(k) ?? null
  const stuckCells = stuck.map(cellAt).filter(Boolean)
  if (!stuckCells.length) return { ok: false, why: 'no_stuck_cells', tried: [] }
  const near = (x, z) => stuckCells.some(c => Math.max(Math.abs(c.at[0] - x), Math.abs(c.at[2] - z)) <= ACCESS_NEAR)
  const targets = record.cells.filter(c => near(c.at[0], c.at[2]) && !isDone(c, read))
  const cols = new Set()
  for (const c of record.cells) if (near(c.at[0], c.at[2])) cols.add(`${c.at[0]},${c.at[2]}`)
  const tried = []
  let best = null
  const score = p => [p.doneStuck.length, p.done.length, -p.digs.length, -p.fall]
  const better = (a, b) => { if (!b) return true; const sa = score(a), sb = score(b); for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return sa[i] > sb[i]; return false }
  for (const ck of [...cols].sort()) {
    const [x, z] = ck.split(',').map(Number)
    const tops = (nodes.get(ck) ?? []).filter(y => cellAt(k3(x, y - 1, z)))
    if (!tops.length) { tried.push({ col: ck, why: 'no_top' }); continue }
    for (const T of [...tops].sort((a, b) => b - a)) {
      let last = null, found = false
      for (let depth = 1; depth <= ACCESS_DIG_MAX + FALL_MAX; depth++) {
        const p = planColumn({ read, col: [x, z], topFeet: T, depth, cellAt, isDone, targets, stuck, mayDig, blockOf, domain, home })
        if (!p.ok) { last = p.why; if (/^top_/.test(p.why)) break; continue }
        found = true
        if (better(p, best)) best = p
      }
      tried.push({ col: ck, top: T, why: found ? 'ok' : last })
    }
  }
  if (best) return { ...best, tried }
  return { ok: false, why: `no_plan (${tried.filter(t => t.why !== 'no_top').slice(0, 4).map(t => `${t.col}:${t.why}`).join(' ') || 'no column top is walked'})`, tried }
}

/** May this bot try an access for this target set now? mem = { tries: { key: { n, at } } }. Pure. */
export function accessAllowed (mem, key, now, { tries = ACCESS_TRIES, window = ACCESS_RETRY_MS } = {}) {
  const t = mem?.tries?.[key]
  if (!t || now - t.at >= window) return true
  return t.n < tries
}
/** Count one attempt. */
export function accessNote (mem, key, now, { window = ACCESS_RETRY_MS } = {}) {
  if (!mem) return
  mem.tries ??= {}
  const t = mem.tries[key]
  mem.tries[key] = !t || now - t.at >= window ? { n: 1, at: now } : { n: t.n + 1, at: t.at }
}
/** The bag's shortfall for a plan's need -> { block: missing }, {} when it holds them all and ACCESS_SPARE more of the climb's
 *  own block (the climb-out fallback places it). Pure. */
export function accessShort (need, count, climbBlock = null, spare = ACCESS_SPARE) {
  const out = {}
  for (const [n, k] of Object.entries(need)) { const want = k + (n === climbBlock ? spare : 0); const have = Number(count(n)) || 0; if (have < want) out[n] = want - have }
  return out
}
