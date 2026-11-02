// STATIONKEEP-01: THE BOTS TAKE BACK THE STATIONS THEY PUT DOWN (resource-model-1102 stage 2, docs/reports/
// resource-management-2026-11-02.md §11 row 2; OWNER 11-02 "pick up self-placed stations"). PURE: the switch, the smelt's
// retake decision, the stray-station survey of the plaza, the row details. Nothing here touches a bot or a file.
//
// WHY (measured 11-02, bagdiet-01's block dumps and the 00:00-12:43Z rows): 25-34 crafting tables stand within 16 blocks of
// home and 69-120 within 80; craft takes its table back 88 of 184 times; SMELT NEVER TAKES BACK THE FURNACE IT PLACED (no code
// path did); flowledger-01's first run (11-02 16:27Z, 6 h): 68 tables/furnaces crafted, 80 left behind by craft/smelt.
//
// WHAT IT DOES
//   1. smelt: a furnace THIS CALL placed (place() returned its cell) is dug back once the job is DRAINED -- nothing left to
//      cook and nothing left to collect in the last read of its window -- by the same collectManually walk-dig-pickup craft's
//      table retake uses (it equips the best tool: a furnace dug bare-handed drops nothing). Never a furnace that changed since
//      it was placed (the block watch), never with no room for it, never after an abort. Every outcome is a
//      `_station_retaken` row.
//   2. the tidy (tidy-01's project, its visit and its order): STRAY stations round the plaza -- a crafting table or furnace
//      inside the tidy square that no plan cell, plan box, protected zone, project record or project reservation holds (those
//      are the plaza's own stations and the workshop's) -- are dug and carried; the bag allowance's station row (one of each)
//      then banks every copy past the first at the next town visit, so the stations end in the town's chests.
//      The KEEP_PUBLIC nearest to home of each kind STAY (a plaza with no table makes every craft put its own down: the
//      churn this removes). A lit furnace, or one the town ledger last saw holding anything, stays. At most SWEEP_MAX a visit.
//      A complete tidy with strays left is "damaged" (shop order: a repair visit) until the strays are gone or every one has
//      been given up by this bot (SWEEP_TRIES visits).
// STATIONKEEP=off is the one-setting rollback (both halves).

export const STATIONKEEP = Object.freeze({ on: String(process.env.STATIONKEEP ?? '').trim().toLowerCase() !== 'off' })
export const STRAY_NAMES = Object.freeze(['crafting_table', 'furnace'])
/** The nearest-to-home strays of each kind that stay: the plaza's public stations. */
export const KEEP_PUBLIC = Object.freeze({ crafting_table: 2, furnace: 2 })
/** Strays one tidy visit digs (each a walk and a dig: the visit's budget is SHOP_SKILL_MS). */
export const SWEEP_MAX = 3
/** A stray a bot's sweep tried this many visits and that still stands is given up by that bot. */
export const SWEEP_TRIES = 2
/** The survey's reach round home (findBlocks' radius): the tidy square's half-width, measured as a box. */
export const SWEEP_R = 32
/** The order's cached answer lives this long (the order asks every decision). */
export const SWEEP_CACHE_MS = 5 * 60 * 1000

const isName = n => STRAY_NAMES.includes(n)

/**
 * SHOULD SMELT DIG BACK THE FURNACE IT PLACED -> { retake: bool, why }. Pure.
 *   placed     this call placed a furnace (its cell is known)
 *   aborted    the call is being aborted (an aborted skill does not dig)
 *   input      the input slot's count at the last read of the window (undefined = unreadable)
 *   output     the output slot's count at the last read (undefined = unreadable)
 * Fuel left in the slot is not a reason to stay: the furnace's drop and its contents land where the bot stands to dig it.
 */
export function smeltRetake ({ placed = false, aborted = false, input, output } = {}) {
  if (!STATIONKEEP.on) return { retake: false, why: 'off' }
  if (!placed) return { retake: false, why: 'not_placed' }
  if (aborted) return { retake: false, why: 'aborted' }
  if (input === undefined || output === undefined) return { retake: false, why: 'unread' }
  if ((Number(input) || 0) > 0) return { retake: false, why: 'input_left' }
  if ((Number(output) || 0) > 0) return { retake: false, why: 'output_left' }
  return { retake: true, why: 'drained' }
}

/**
 * THE PLAZA'S STRAY STATIONS -> { sweep: [{ at, name, d }], kept: [...], skipped: { reason: n } }. Pure.
 *   found     [{ at: [x, y, z], name, lit }] -- every crafting table and furnace the bot sees round home
 *   home      { x, y, z }
 *   avoid     (x, z) -> reason | null (tidy.mjs tidyAvoid over the town: zones, the plan's cells, boxes and plots, wells, the
 *             composter, the tree farm, every project's record columns and reservation)
 *   cells     Set "x,y,z" of every project record cell (belt and braces)
 *   holds     (key) -> bool: the town ledger's newest entry for this furnace says it holds something or is lit
 *   given     (key) -> bool: this bot gave the stray up
 *   r         the square's half-width; dy the height band round home.y
 * Order: per kind, nearest home first; the first KEEP_PUBLIC[kind] that are otherwise strays are KEPT; the rest are swept,
 * nearest first overall.
 */
export function strayStations (found = [], { home, avoid = () => null, cells = new Set(), holds = () => false, given = () => false, r = SWEEP_R, dy = 14, keep = KEEP_PUBLIC } = {}) {
  const skipped = {}
  const skip = why => { skipped[why] = (skipped[why] ?? 0) + 1 }
  if (!home || ![home.x, home.y, home.z].every(Number.isFinite)) return { sweep: [], kept: [], skipped: { no_home: 1 } }
  const seen = new Set()
  const cand = []
  for (const s of Array.isArray(found) ? found : []) {
    if (!s || !Array.isArray(s.at) || s.at.length !== 3 || !isName(s.name)) continue
    const [x, y, z] = s.at
    const k = `${x},${y},${z}`
    if (seen.has(k)) continue
    seen.add(k)
    if (Math.max(Math.abs(x - home.x), Math.abs(z - home.z)) > r || Math.abs(y - home.y) > dy) { skip('outside'); continue }
    if (cells.has(k)) { skip('record_cell'); continue }
    const a = avoid(x, z)
    if (a) { skip(`guarded`); continue }
    if (s.name === 'furnace' && s.lit) { skip('lit'); continue }
    if (s.name === 'furnace' && holds(k)) { skip('holds'); continue }
    cand.push({ at: [x, y, z], name: s.name, d: Math.hypot(x - home.x, y - home.y, z - home.z), k })
  }
  cand.sort((a, b) => a.d - b.d || a.k.localeCompare(b.k))
  const kept = [], sweep = []
  const n = {}
  for (const c of cand) {
    n[c.name] = (n[c.name] ?? 0) + 1
    if (n[c.name] <= (keep[c.name] ?? 0)) { kept.push(c); continue }
    if (given(c.k)) { skip('given_up'); continue }
    sweep.push(c)
  }
  return { sweep: sweep.map(({ k, ...c }) => c), kept: kept.map(({ k, ...c }) => c), skipped }
}

/** Notes a visit's sweep tries: each stray TRIED that still stands counts toward this bot giving it up. Mutates `mem`. Pure. */
export function noteSweep (mem, tried = [], standing = () => true) {
  for (const k of new Set(tried)) if (standing(k)) mem.set(k, (mem.get(k) ?? 0) + 1)
  return mem
}
export const sweepGivenUp = (mem, k, tries = SWEEP_TRIES) => (mem?.get(k) ?? 0) >= tries

/** The `_station_retaken` / `_station_swept` row detail. Pure. */
export function stationRowDetail ({ at = null, name = '-', by = '-', outcome = '-', why = '-' } = {}) {
  const where = Array.isArray(at) ? at.join(',') : (at && Number.isFinite(at.x) ? `${at.x},${at.y},${at.z}` : '-')
  return `station=${name} at=${where} by=${by} outcome=${outcome} why=${String(why).replace(/\s+/g, '_').slice(0, 120)}`.slice(0, 300)
}
/** The `_station_sweep` visit row (one a tidy visit that looked): the survey's counts. Pure. */
export function sweepVisitDetail ({ found = 0, sweep = 0, kept = 0, dug = 0, back = 0, skipped = {} } = {}) {
  const sk = Object.entries(skipped).map(([k, v]) => `${k}:${v}`).join(',') || '-'
  return `found=${found} strays=${sweep} kept=${kept} dug=${dug} back=${back} skipped=${sk}`.slice(0, 300)
}
