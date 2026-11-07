// STATIONS-01: THE TOWN'S CRAFTING TABLES AND FURNACES (OWNER 11-06 ~12:40Z: "what can we do about crafting tables and furnaces?
// can the greenskeepers pick up all the ones thrown across town and use the materials for something? can we instruct the bots to
// use [stations] in town in designated areas that are already built?"). Design docs/reports/stations-design-2026-11-06.md
// (Claude + Codex, reconciled). SUPERSEDES stationkeep-01 (its smelt retake is carried here, with the exact-furnace check; its
// plaza sweep is replaced by the groundskeepers' town-and-rings sweep). PURE: the switches, the decisions, the row details.
// skills.mjs (smelt / smeltInner, craft / craftLevel, buildTidy) wires them.
//
// MEASURED 11-06 (world read: every chunk within 136 of the 16 homes, 324 a town, 0 missing; telemetry 12 h full walk, 828,238
// rows, 80 bots): 3,828 tables + 4,577 furnaces within 136 of home; 45 of 45 workshop stations found (the control); 4,435 surface
// strays (~277 a town), 3,711 deep (mines, y < home - 20). Placed and not taken back in 12 h: smelt 101 furnaces (no code path
// ever took one back), 75% of all leaks underground; craft 92 tables placed, 68 back. 90 furnaces + 19 tables crafted, none while
// holding one. Town chests hold 17 tables + 8 furnaces fleet-wide.
//
// THE PARTS (each its own switch; STATIONS=0|off turns every part off = gkforever-01 exactly):
//   RETAKE   (STN_RETAKE)   smelt digs back the furnace THIS CALL placed once the job is drained -- only when the furnace the job
//                          used IS the one it placed (the slots read are that furnace's: Codex), never when another session
//                          leases it, never without a harvest tool or room. Away from town (mines, expeditions) placing stays
//                          allowed; the station comes back with the bot. A station put at a DESIGNATED cell stays (it is the
//                          town's).
//   SWEEP    (STN_SWEEP)    the groundskeepers' visit (the tidy) takes up stray tables and furnaces across the town square and its
//                          rings (home +- SWEEP.R), surface band only (the deep ones are the take-back's: walking a mine for a
//                          table is movement risk). A stray: in no project record, not a workshop / designated station, not in a
//                          protected zone, not within SWEEP.bellR of a bell (a village's), not beside a hopper, and a furnace
//                          only unlit, unleased, and proven EMPTY by its own window under the bot's lease (unknown is not empty;
//                          a furnace with contents is left for furnace_drain). At most SWEEP.max a visit or SWEEP.ms; a stray
//                          tried twice and still standing is given up by that bot for SWEEP.giveUpMs. The copies past the bag
//                          allowance's one of each are banked by the town deposit into the chests.
//   REUSE    (STN_REUSE)    in town (the town square, at the surface) every craft and smelt tries the town's stations first:
//                          the complete workshop's fit-out, else the town plan's work-plot station cells (the DESIGNATED spot),
//                          looked up by key within STN.reach, before the nearest-found ones. A town with neither a workshop
//                          station nor a station at its designated cell puts the station AT the designated cell (and leaves it:
//                          it is the town's from then on), never at a random spot.
//   WITHDRAW (STN_WITHDRAW) a craft of a crafting_table or furnace in town, by a bot holding none, takes one from the town chests
//                          first (the town index says one is there); it crafts only when the withdraw brought none.
//   SURPLUS  (STN_SURPLUS)  a spare crafting table (past the one the bag keeps) is FUEL for the bot's own smelt (300 ticks, burned
//                          before planks: a surplus table has no other use; a log is worth four planks). Spare furnaces stay in the
//                          chests as the withdraw stock (90 crafted in 12 h: the demand eats them). A smelting row is a later
//                          building piece, once the chests show a standing furnace surplus.

const OFF = v => ['0', 'off', 'false', 'no'].includes(String(v ?? '').trim().toLowerCase())
export const STN_PARTS = Object.freeze(['retake', 'sweep', 'reuse', 'withdraw', 'surplus'])
/** THE SWITCHES -> bool. STATIONS=0|off: every part off; else STN_<PART>=0|off turns that part off; default on. Pure. */
export function stnOn (part, env = (typeof process !== 'undefined' ? process.env : {})) {
  if (OFF(env?.STATIONS)) return false
  if (part == null) return true
  return !OFF(env?.[`STN_${String(part).toUpperCase()}`])
}

export const STATION_NAMES = Object.freeze(['crafting_table', 'furnace'])
const isStation = n => STATION_NAMES.includes(n)

export const STN = Object.freeze({
  reach: 160,          // a town station is looked up by key this far from the bot (the town square is home +- 64..74)
  surfaceDown: 12,     // "at the surface": no deeper than home.y - this (the town shaft and the mines are below)
})
export const SWEEP = Object.freeze({
  R: 136,              // the town square and its rings (home +- s + 64; the measured box)
  down: 16,            // the surface band below home.y the sweep looks in ...
  up: 40,              // ... and above it (hills, the town's builds)
  max: 4,              // strays taken a visit
  ms: 90_000,          // ... or this long of the visit
  minMs: 30_000,       // what must be left of a visit for a sweep after the grounds work
  bellR: 32,           // a station this near a bell is a village's
  tries: 2,            // a stray tried this many visits and still standing ...
  giveUpMs: 6 * 60 * 60_000,   // ... is given up by that bot this long
  cacheMs: 5 * 60_000, // the order's "is there a stray" answer lives this long
  found: 512,          // findBlocks' count
})

const num = v => (Number.isFinite(Number(v)) ? Number(v) : null)
const keyOf = a => (Array.isArray(a) ? a.join(',') : a && Number.isFinite(a.x) ? `${a.x},${a.y},${a.z}` : String(a))

/** Is `pos` in town at the surface (the town square: Chebyshev <= s round home, no deeper than home.y - STN.surfaceDown)? Pure. */
export function inTownSurface (pos, home, s, { down = STN.surfaceDown } = {}) {
  if (!pos || !home || ![pos.x, pos.y, pos.z, home.x, home.y, home.z].every(Number.isFinite)) return false
  const half = num(s)
  if (half == null || half <= 0) return false
  return Math.max(Math.abs(Math.floor(pos.x) - home.x), Math.abs(Math.floor(pos.z) - home.z)) <= half && Math.floor(pos.y) >= home.y - down
}

/**
 * THE TOWN'S STATIONS -> { tables: Set, furnaces: Set, source, spot: { table: [cell...], furnace: [cell...] } }. Pure.
 *   shop   workbench.mjs workshopStations(record): the COMPLETE workshop's fit-out keys (empty sets otherwise)
 *   plan   the town plan: its `work` plot's `stations` [{ at, kind, stand }] (townplan.mjs: crafting_table / furnace cells)
 * The workshop's stations when it has any (source 'workshop'); else the work plot's cells (source 'plan': the designated spot,
 * whose cells are both what the bots look up and where a town with no station puts one); else none.
 */
export function townStations (shop, plan) {
  const out = { tables: new Set(), furnaces: new Set(), source: 'none', spot: { crafting_table: [], furnace: [] } }
  const st = (plan?.plots ?? []).find(p => p?.id === 'work' && Array.isArray(p.stations))?.stations ?? []
  for (const c of st) {
    if (!Array.isArray(c?.at) || c.at.length !== 3 || !isStation(c.kind)) continue
    out.spot[c.kind].push({ at: c.at.slice(), stand: Array.isArray(c.stand) ? c.stand.slice() : null })
  }
  const t = shop?.tables, f = shop?.furnaces
  if ((t?.size ?? 0) + (f?.size ?? 0) > 0) {
    for (const k of t ?? []) out.tables.add(k)
    for (const k of f ?? []) out.furnaces.add(k)
    out.source = 'workshop'
    return out
  }
  if (out.spot.crafting_table.length || out.spot.furnace.length) {
    for (const c of out.spot.crafting_table) out.tables.add(c.at.join(','))
    for (const c of out.spot.furnace) out.furnaces.add(c.at.join(','))
    out.source = 'plan'
  }
  return out
}

/** THE STATIONS THE SWEEP NEVER TAKES -> Set "x,y,z": the town's (workshop or designated) AND the plan's designated cells always
 *  (Codex r1 BLOCKER 2: a station put at a designated cell before the workshop stood is still the town's). Pure. */
export function townKeep (ts) {
  return new Set([...(ts?.tables ?? []), ...(ts?.furnaces ?? []), ...Object.values(ts?.spot ?? {}).flat().filter(c => Array.isArray(c?.at)).map(c => c.at.join(','))])
}

/**
 * WHERE A TOWN WITH NO STANDING STATION PUTS ONE -> { at, stand } | null. Pure. Only for the designated spot (source 'plan'):
 * the first of the kind's work-plot cells whose cell reads free (`free(at)`: air or replaceable) -- a cell already holding the
 * station means the town HAS one (the caller found it first); a workshop town never places (its fit-out is the build's).
 */
export function designatedCell (ts, kind, free = () => false) {
  if (!ts || ts.source !== 'plan' || !isStation(kind)) return null
  for (const c of ts.spot?.[kind] ?? []) if (free(c.at)) return c
  return null
}

/**
 * SHOULD SMELT DIG BACK THE FURNACE IT PLACED -> { retake, why }. Pure. (stationkeep-01's, plus Codex's exact-furnace rule and the
 * designated cell.)
 *   placed      this call placed a furnace (its key); used: the key of the furnace the job ran in (its slots are what was read)
 *   designated  the placed cell is a designated town station cell (it stays: the town's)
 *   aborted     the call is being aborted; input/output/fuel: the last read of the window (undefined = unreadable)
 */
export function smeltRetake ({ placed = null, used = null, designated = false, aborted = false, input, output, fuel, on = stnOn('retake') } = {}) {
  if (!on) return { retake: false, why: 'off' }
  if (!placed) return { retake: false, why: 'not_placed' }
  if (designated) return { retake: false, why: 'designated' }
  if (aborted) return { retake: false, why: 'aborted' }
  if (used == null || keyOf(used) !== keyOf(placed)) return { retake: false, why: 'not_the_job_furnace' }
  if (input === undefined || output === undefined || fuel === undefined) return { retake: false, why: 'unread' }
  if ((Number(input) || 0) > 0) return { retake: false, why: 'input_left' }
  if ((Number(output) || 0) > 0) return { retake: false, why: 'output_left' }
  if ((Number(fuel) || 0) > 0) return { retake: false, why: 'fuel_left' }
  return { retake: true, why: 'drained' }
}

/** IS A FURNACE PROVEN EMPTY by its own window (input, fuel, output all read null; not burning)? -> { ok, why }. Pure. */
export function furnaceEmpty (seen) {
  if (!seen) return { ok: false, why: 'unread' }
  for (const k of ['input', 'fuel', 'output']) {
    if (seen[k] === undefined) return { ok: false, why: `unread_${k}` }
    if (seen[k] && (Number(seen[k].count) || 0) > 0) return { ok: false, why: `holds_${k}` }
  }
  if (seen.lit) return { ok: false, why: 'lit' }
  return { ok: true, why: 'empty' }
}

/**
 * THE TOWN'S STRAY STATIONS -> { sweep: [{ at, name, d }], skipped: { why: n } }. Pure.
 *   found     [{ at: [x, y, z], name, lit }]: every crafting table and furnace the bot sees round home
 *   home      { x, y, z }; from: where the bot stands (the sweep walks nearest-to-the-bot first)
 *   cells     Set "x,y,z": every project record's cells (any state: a running build's station is its own)
 *   keep      Set "x,y,z": the town's stations (townStations' tables + furnaces: the workshop's, or the designated cells)
 *   zone      (x, y, z) -> truthy: a protected zone (a village, a fixture)
 *   bells     [[x, y, z]]: bells seen (a village's stations are the village's)
 *   hopper    (key) -> bool: a hopper beside it (its contents change without a lease)
 *   leased    (key) -> bool: a furnace another session holds now
 *   given     (key) -> bool: this bot gave it up
 * Order: nearest the bot first (the walk), then the key. Lit furnaces are skipped here; the empty proof is the visit's.
 */
export function strayStations (found = [], { home, from = null, cells = new Set(), keep = new Set(), zone = () => false, bells = [], hopper = () => false, leased = () => false, given = () => false, R = SWEEP.R, down = SWEEP.down, up = SWEEP.up, bellR = SWEEP.bellR } = {}) {
  const skipped = {}
  const skip = why => { skipped[why] = (skipped[why] ?? 0) + 1 }
  if (!home || ![home.x, home.y, home.z].every(Number.isFinite)) return { sweep: [], skipped: { no_home: 1 } }
  const me = from && [from.x, from.y, from.z].every(Number.isFinite) ? from : home
  const seen = new Set(), out = []
  for (const s of Array.isArray(found) ? found : []) {
    if (!s || !Array.isArray(s.at) || s.at.length !== 3 || !isStation(s.name)) continue
    const [x, y, z] = s.at
    const k = `${x},${y},${z}`
    if (seen.has(k)) continue
    seen.add(k)
    if (Math.max(Math.abs(x - home.x), Math.abs(z - home.z)) > R) { skip('outside'); continue }
    if (y < home.y - down) { skip('deep'); continue }
    if (y > home.y + up) { skip('high'); continue }
    if (keep.has(k)) { skip('town_station'); continue }
    if (cells.has(k)) { skip('record_cell'); continue }
    if (zone(x, y, z)) { skip('zone'); continue }
    if ((bells ?? []).some(b => Array.isArray(b) && Math.hypot(b[0] - x, b[1] - y, b[2] - z) <= bellR)) { skip('village'); continue }
    if (hopper(k)) { skip('hopper'); continue }
    if (s.name === 'furnace' && s.lit) { skip('lit'); continue }
    if (s.name === 'furnace' && leased(k)) { skip('leased'); continue }
    if (given(k)) { skip('given_up'); continue }
    out.push({ at: [x, y, z], name: s.name, d: Math.hypot(x - me.x, y - me.y, z - me.z), k })
  }
  out.sort((a, b) => a.d - b.d || a.k.localeCompare(b.k))
  return { sweep: out.map(({ k, ...c }) => c), skipped }
}

/** A visit's tries: each stray tried that still stands counts toward this bot giving it up (stamped). Mutates `mem`. Pure. */
export function noteSweep (mem, tried = [], standing = () => true, now = Date.now()) {
  for (const k of new Set(tried)) {
    if (!standing(k)) { mem.delete(k); continue }
    const p = mem.get(k)
    mem.set(k, { n: (p?.n ?? 0) + 1, at: now })
  }
  return mem
}
// GKLEASE-02 (control session 11-07; the stations-01 effect audit): THE SWEEP'S GIVE-UP IS THE TOWN'S. MEASURED fleet 11-07 06-14Z:
// 1,868 failed sweep tries on 342 strays (179 successes), the worst board-a strays 54-58 tries each ("floor dig", "arrived out of
// reach", "unreachable"): the give-up was each bot's memory (5 bots x 2 tries, and every restart forgot it). Each bot writes its own
// tries to `<dir>/stations.sweep.<holder>.json`; a stray is given up when the town's tries (summed over holders, each inside
// SWEEP.giveUpMs) reach SWEEP.tries.
/** The town's tries on stray `k` -> int. Pure over the holders' maps ({ k: { n, at } }). */
export function sweepTownTries (maps = [], k, now = Date.now(), { ms = SWEEP.giveUpMs } = {}) {
  let n = 0
  for (const m of maps ?? []) { const v = m?.[k]; if (v && Number.isFinite(v.at) && now - v.at < ms && v.at <= now + 60_000) n += Number(v.n) || 0 }
  return n
}
export const sweepTownGiven = (maps, k, now = Date.now(), { tries = SWEEP.tries, ms = SWEEP.giveUpMs } = {}) => sweepTownTries(maps, k, now, { ms }) >= tries
/** Has this bot given the stray up (SWEEP.tries tries, the last within SWEEP.giveUpMs)? Pure. */
export function sweepGivenUp (mem, k, now = Date.now(), { tries = SWEEP.tries, ms = SWEEP.giveUpMs } = {}) {
  const v = mem?.get?.(k)
  if (!v) return false
  return (v.n ?? 0) >= tries && now - (v.at ?? 0) < ms
}

/**
 * TAKE A STATION FROM THE TOWN CHESTS INSTEAD OF CRAFTING IT? -> bool. Pure. The craft of a crafting_table or furnace, in town,
 * by a bot holding none of it, when the town index shows at least one in the chests.
 */
export function withdrawFirst ({ item, held = 0, inTown = false, stock = 0, on = stnOn('withdraw') } = {}) {
  return !!on && isStation(item) && !!inTown && (Number(held) || 0) < 1 && (Number(stock) || 0) >= 1
}

/** SPARE TABLES THE BOT'S OWN SMELT MAY BURN -> n: every table past the one the bag keeps (STN_SURPLUS), else none. Pure. */
export const spareTables = (held, on = stnOn('surplus')) => (on ? Math.max(0, (Number(held) || 0) - 1) : 0)

/** The `_station_retaken` / `_station_swept` / `_station_use` row detail. Pure. */
export function stationRowDetail ({ at = null, name = '-', by = '-', outcome = '-', why = '-', src = null } = {}) {
  const where = Array.isArray(at) ? at.join(',') : (at && Number.isFinite(at.x) ? `${at.x},${at.y},${at.z}` : '-')
  return `station=${name} at=${where} by=${by} outcome=${outcome}${src ? ` src=${src}` : ''} why=${String(why).replace(/\s+/g, '_').slice(0, 120)}`.slice(0, 300)
}
/** The `_station_sweep` visit row: the survey's counts. Pure. */
export function sweepVisitDetail ({ found = 0, strays = 0, tried = 0, back = 0, left = 0, skipped = {} } = {}) {
  const sk = Object.entries(skipped).map(([k, v]) => `${k}:${v}`).join(',') || '-'
  return `found=${found} strays=${strays} tried=${tried} back=${back} left=${left} skipped=${sk}`.slice(0, 300)
}
