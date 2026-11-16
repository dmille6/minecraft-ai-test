// STOCKYARD-01: THE TOWN STOCKPILE YARD (OWNER 11-02 ~13:00Z "is there something we can build larger than a chest to hold this
// massive amount of cobblestone ... can we just have a town stockpile at the side of town?"; ~13:10Z "how do we prevent trees from
// growing there and other things getting in the way of deposits?" and "can we order one town bot to move the current items in
// chests that need to be in the stock yard?"). PURE: the switch, the piles' geometry over the record, the bays' state from a world
// read, and the visit's plan (stock the bag's surplus, clerk the chests' surplus, refill the chests from the piles, clear the
// aisles). Nothing here touches a bot or a file; the visit is skills.mjs yardVisit (buildrun.mjs runVisit over pile cells).
//
// MEASURED 11-02 00:00-12:43Z (80 bots): bags held 19,665 cobblestone (331 of 1,614 used slots), 1,722 cobbled_deepslate and 4,007
// bamboo; town chests are capped at 1,000 cobble (stocktarget.mjs TOWN_COBBLE_CAP) and 19 deposits in 6 h ended "the cobble stays:
// no container here has room for a whole stack".
//
// THE YARD (blueprints/yard@1.json, docs/reports/stockyard-2026-11-02/make_yard.py): an 18 x 15 paved floor one block above the
// ground -- saplings, grass and bamboo cannot root on stone -- with four BAYS of 2 x 11 floor cells and 2-wide aisles between and
// around them, eight torches on the corners and the back aisle. Two wide, so every pile cell is beside an aisle (on the fake server
// a 3-wide bay's middle row above the eye had no sight line: 102 of 114 placed). It is an ordinary blueprint project: sited by buildsite.mjs siteBlueprint in the
// town ring (22..44 from home) clear of every reservation (plan, wells, the tree farm +2, every other record + PROJECT_GAP), its
// record cells keep-outs like every project's (no planting, no siting, no tidy on it), its front facing home (the paths' leg).
//
// THE PILES ARE NEVER RECORD CELLS (a pile that shrinks is never damage): a bay's slots are computed here from its floor cells
// (role bayN). A pile is a RAMP: layer k (1..YARD_H) covers the bay's rows from v = v0 + (k - 1) to the far end, so the front of the
// pile is a staircase of one-block steps a builder walks up -- every slot's support is the TOP face of the block under it, seen
// from above (layers 1-2 from the aisle floor, eye at +2.62; layer k >= 3 standing on layer k - 1). Layer k fills far end first, so
// the builder stands on the part of layer k - 1 still open. YARD_H = 4 keeps the highest stand 3 blocks above the floor: a fall from
// it costs nothing. CAPACITY: 2 x (11 + 10 + 9 + 8) = 76 a bay, 304 a yard. One material per bay (neat rows): cobblestone,
// cobbled_deepslate, bamboo_block (9 bamboo each), the fourth bay the overflow of any of them; dirt and the stone variants keep
// their existing exits (the well's list).
//
// PRIORITY (owner 11-02): chests for valuables and working stock, the yard for bulk, the well only for true junk.
//   stock   the visitor's bag surplus above YARD_BAG_KEEP goes onto the piles
//   clerk   the town's chests above YARD_CHEST_KEEP (the build reserve + one stack) move to the piles, YARD_VISIT_MAX a visit
//   refill  a town below its build reserve gets cobblestone dug back from the piles (the yard's withdrawal: "mining back")
//   upkeep  the aisles (the cells over the floor outside the bays) are cleared of leaves, saplings, plants, snow and stray blocks
// One bot at a time (YARD_BUILDERS = 1: the clerk's lease is the project's admission slot).
//
// YARD=off is the kill switch (never offered, never sited). On only in YARD_POOLS (default 'showcase') until a fleet rollout.

import { rot } from './townplan.mjs'

export const YARD_PLOT = 'yard'
export const YARD_BLUEPRINT = 'yard@1'
export const YARD_BUILDERS = 1
/** Layers a pile rises above the floor (see the header: the highest stand is YARD_H - 1 above the floor). */
export const YARD_H = 4
/** What a pile holds, one name a bay, in the order a free bay is given. */
export const YARD_BULK = Object.freeze(['cobblestone', 'cobbled_deepslate', 'bamboo_block'])
/** The bag keeps this much of the cobble family (cobblestone first, then cobbled_deepslate): the stockpile rung's 64 + one light
 *  project visit's hold (shop.mjs PROJECT_VISIT_HOLD). */
export const YARD_BAG_KEEP_COBBLE = 128
/** Bamboo kept as bamboo (fuel, sticks); the rest is crafted into bamboo_block (9 : 1) for the pile. */
export const YARD_BAMBOO_KEEP = 64
export const BAMBOO_PER_BLOCK = 9
/** The town's chests keep this much cobblestone (stocktarget.mjs BUILD_RESERVE.cobblestone 256 + one stack); above it the clerk
 *  moves stone to the piles (cobblestone only: the reserve has no deepslate key, so a withdraw takes none). */
export const YARD_CHEST_KEEP = Object.freeze({ cobblestone: 320 })
/** Below this the town's chests are refilled from the piles (the build reserve). */
export const YARD_REFILL_BELOW = 256
/** At most this many blocks placed, or dug back, a visit. */
export const YARD_VISIT_MAX = 64
/** A bag surplus worth a trip on its own: one whole stack frees a slot. */
export const YARD_STOCK_MIN = 64
/** The bag is under pressure from this many used slots: its stock visit goes first (activeProject's repair loop). */
export const YARD_URGENT_SLOTS = 30
/** The siting's earthwork limits for the 18 x 15 floor (buildsite.mjs screenSite `earth`; the house's EARTH is 3 / 40 / 30). */
export const YARD_EARTH = Object.freeze({ col: 3, fill: 120, cut: 120 })
/** A yard visit that did nothing (no work, nothing drawn, no room, nothing placed or dug) rests this bot's yard work this long:
 *  a visit that cannot act is never re-sent at once (Claude r1 BLOCK 2: an empty clerk draw was re-ordered every cooldown). */
export const YARD_REST_MS = 20 * 60_000
/** Cobblestone dug back a refill visit (the bank-back after it must fit the visit's clock). */
export const YARD_REFILL_MAX = 32
/** Aisle clutter cleared at most this many cells a visit. */
export const YARD_CLEAR_MAX = 16

// ================================================================================================================================
// YARDLANES-01 (bagfix-02show; OWNER 11-16): ONE LANE PER KIND, GROWING TO A CAP, AND MORE YARDS BESIDE THE FIRST.
// "lets build a new lane for each type of item, we'll start with a set length of lane, it can expand to a certain point in length and
// height, but there should be some kind of cap and limit" / "can our storage yard have storage for seeds, gravel, tuff, diorite,
// granite, clay, deepslate and any other kind of item worth keeping?" / "store everything now, and evaluate what we use".
// WAS: 3 kinds, one yard of 4 bays (304 or 656 slots), 64 a visit, one bot at a time; it filled in 2 h 11 min (the header above).
// NOW (YARDLANES=off restores every line of the old yard):
//   A LANE is a bay (2 wide: every cell beside an aisle, the header's sight-line finding). The first time a kind is banked it takes
//        the first empty lane. It starts LANES.start (8) rows long at the bay's far end and GROWS by LANES.step (8) rows when the
//        rows it has are full, to the bay's own length (22 in yard@2, 11 in yard@1), each stepped to YARD_H (4): 52 -> 116 -> 164
//        blocks in yard@2. The ramp is the old one, so a builder still walks up one-block steps and every dig is a top block --
//        gravel and sand stand on the paved floor or on their own kind and are only ever taken from the top.
//   CAPS a kind holds at most laneCapOf(kind) lanes over every yard (2; cobblestone and cobbled_deepslate 4). All of it placed and no
//        lane left to open: the kind is FULL -- nothing more of it is banked (laneRoom 0), and the well may take it again (`over_cap`).
//   MORE YARDS  YARD_PLOTS: `yard2` .. are ordinary project records on the yard blueprints, each after the one before, sited by the
//        yard's own siting ranked nearest the FIRST yard (nearYardRank), built by LANES.builders bots at once with the cobblestone in
//        their bags; LANES.modules (4) yards in all = 16 lanes.
//   LEASES one lease a LANE (`lane<id>` on the yard's record), so LANES.visitors bots stock one yard at once, each in its own lanes.
// Settings: YARD_LANE_START, YARD_LANE_STEP, YARD_LANE_CAPS ("cobblestone:4,cobbled_deepslate:4,*:2"), YARD_MODULES, YARD_LANE_MIN,
// YARD_LANE_BUILDERS, YARD_LANE_VISITORS, YARD_LANE_VISIT_MAX, YARD_LANE_PASS_MS (a passing bot's stock visit is bounded: 150 s).
const isOffV = v => ['off', '0', 'false', 'no'].includes(String(v ?? '').trim().toLowerCase())
const numV = (v, d, lo = 1, hi = 1e6) => { const n = Number(String(v ?? '').trim()); return String(v ?? '').trim() !== '' && Number.isFinite(n) && n >= lo && n <= hi ? Math.floor(n) : d }
/** "a:4,b:4,*:2" -> { a: 4, b: 4, '*': 2 }. Pure; an unreadable part is dropped. */
export function laneCaps (raw, dflt = 'cobblestone:4,cobbled_deepslate:4,*:2') {
  const out = {}
  for (const part of String(raw == null || String(raw).trim() === '' ? dflt : raw).split(',')) {
    const [k, v] = part.split(':').map(x => x.trim())
    const n = Number(v)
    if (k && Number.isInteger(n) && n >= 0 && n <= 64) out[k] = n
  }
  if (!Number.isInteger(out['*'])) out['*'] = 2
  return Object.freeze(out)
}
/** THE LANES' SETTINGS -> { on, start, step, caps, modules, min, builders, visitors, visitMax, keepCobble }. Pure. */
export function laneSettings (env = {}, pool = env?.MEMORY_POOL ?? '') {
  // the lanes are the yard's: on only where the yard is (YARD / YARD_POOLS), and YARDLANES=off switches them off alone
  return Object.freeze({ on: !isOffV(env?.YARDLANES) && yardOn(env, pool), start: numV(env?.YARD_LANE_START, 8, 1, 64), step: numV(env?.YARD_LANE_STEP, 8, 1, 64), caps: laneCaps(env?.YARD_LANE_CAPS),
    modules: numV(env?.YARD_MODULES, 4, 1, 6), min: numV(env?.YARD_LANE_MIN, 16, 1, 64), builders: numV(env?.YARD_LANE_BUILDERS, 3, 1, 8), visitors: numV(env?.YARD_LANE_VISITORS, 4, 1, 8),
    row: !isOffV(env?.YARD_ROW), rowCap: numV(env?.YARD_ROW_CAP, 2, 1, 8), rowMin: numV(env?.YARD_ROW_MIN, 8, 1, 64),
    visitMax: numV(env?.YARD_LANE_VISIT_MAX, 128, 1, 640), passMs: numV(env?.YARD_LANE_PASS_MS, 150_000, 10_000, 540_000) })
}
export const LANES = laneSettings(typeof process !== 'undefined' ? process.env : {})
const LOG_KINDS = ['oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log']
/** What a lane may hold: the old three, the stone and earth a town digs up, and logs (one lane a species). */
// compact-01: clay and snow blocks (what the bag's clay balls and snowballs are crafted into) are piled too
export const LANE_KINDS = Object.freeze([...YARD_BULK, 'deepslate', 'stone', 'dirt', 'gravel', 'sand', 'tuff', 'andesite', 'diorite', 'granite', 'clay', 'snow_block', ...LOG_KINDS])
/** The kinds the piles hold -> [name]. Pure. */
export const yardKinds = (on = LANES.on) => (on ? LANE_KINDS : YARD_BULK)
/** A kind's lane cap over every yard -> n. Pure. */
export const laneCapOf = (name, caps = LANES.caps) => (Number.isInteger(caps?.[name]) ? caps[name] : (caps?.['*'] ?? 2))
/** THE YARDS' PLOTS, the first one the old yard's. */
export const YARD_PLOTS_ALL = Object.freeze([YARD_PLOT, 'yard2', 'yard3', 'yard4', 'yard5', 'yard6'])
/** The yards on -> [plot]. Pure. Lanes off: the one yard. */
export const yardPlots = (lanes = LANES) => (lanes?.on ? YARD_PLOTS_ALL.slice(0, Math.max(1, Math.min(YARD_PLOTS_ALL.length, lanes.modules))) : [YARD_PLOT])
export const isYardPlot = plot => YARD_PLOTS_ALL.includes(plot)
/** The yard a yard is built after (null: the first). Pure. */
export const yardAfterOf = plot => { const i = YARD_PLOTS_ALL.indexOf(plot); return i > 0 ? YARD_PLOTS_ALL[i - 1] : null }
/** What `len` rows of a lane hold, `w` wide, stepped to `h` -> blocks. Pure. */
export const laneCapacity = (len, { w = 2, h = YARD_H } = {}) => { let n = 0; for (let k = 1; k <= h; k++) n += Math.max(0, len - k + 1); return n * w }
/** A LANE'S LENGTH NOW -> rows. Pure. The shortest of start, start + step, ... (never past `full`, the bay's own length) whose
 *  capacity is above what it holds (`held`: every block standing in the bay): it grows only when the rows it has are full. */
export function laneLen (held = 0, full = 0, { start = LANES.start, step = LANES.step, w = 2, h = YARD_H } = {}) {
  const f = Math.max(0, Math.floor(Number(full) || 0))
  for (let len = Math.min(f, Math.max(1, start)); len < f; len += Math.max(1, step)) if (laneCapacity(len, { w, h }) > held) return len
  return f
}
/** THE RANK OF A SITE FOR A LATER YARD -> smaller is nearer the first yard's pad (in bands of 8 blocks). Pure. `first` the first yard's
 *  record (its cells), `pad` the candidate's pad cells [[x, z]]. No first yard: 0 (the yard's own ranking decides). */
export function nearYardRank (first, pad = []) {
  const cs = Array.isArray(first?.cells) ? first.cells.filter(c => Array.isArray(c?.at)) : []
  if (!cs.length || !pad.length) return 0
  const cx = cs.reduce((t, c) => t + c.at[0], 0) / cs.length, cz = cs.reduce((t, c) => t + c.at[2], 0) / cs.length
  const px = pad.reduce((t, q) => t + q[0], 0) / pad.length, pz = pad.reduce((t, q) => t + q[1], 0) / pad.length
  return Math.floor(Math.hypot(px - cx, pz - cz) / 8)
}
/**
 * WHAT THE OTHER YARDS HOLD of each kind -> { name: { lanes, room } }. Pure over their bay states (bayStates): the lanes a kind has
 * there and the free slots in them (never an empty lane's: opening one is the picker's own decision).
 */
export function lanesElsewhere (stateLists = []) {
  const out = {}
  for (const states of stateLists) for (const s of (states ?? [])) {
    if (!s?.name) continue
    const e = (out[s.name] ??= { lanes: 0, room: 0 })
    e.lanes += 1; e.room += s.free
  }
  return out
}
/** MAY `name` OPEN A NEW LANE HERE? -> bool. Pure. Under its cap over every yard, and no lane of it elsewhere still has room. Lanes
 *  off: always (the old yard: the first empty bay). */
export function laneMayOpen (states = [], name, { lanes = LANES, others = {} } = {}) {
  if (!lanes?.on) return true
  const o = others?.[name] ?? { lanes: 0, room: 0 }
  if (o.room > 0) return false
  return states.filter(s => s.name === name).length + o.lanes < laneCapOf(name, lanes.caps)
}
/** IS A KIND FULL (every lane it may have, here and elsewhere, is full or cannot be opened)? -> bool. Pure. `empty` the empty lanes
 *  over every yard. The owner's cap: a full kind is banked no more, and only then may the well take it (`over_cap`). */
export function kindOverCap (name, { lanes = LANES, held = { lanes: 0, room: 0 }, empty = 0 } = {}) {
  if (!lanes?.on || !LANE_KINDS.includes(name)) return false
  if ((held?.room ?? 0) > 0) return false
  return (held?.lanes ?? 0) >= laneCapOf(name, lanes.caps) || (!(empty > 0) && (held?.lanes ?? 0) > 0)
}
/**
 * IS THE WELL HELD OFF A KIND FOR THE YARD? -> { hold }. Pure. `room` the storage room the kind has (its lanes' free slots and the
 * lanes it may still open; a row kind: its chest's). THE OWNER'S RULE (11-16): store everything that has a home -- so the hold is
 * the ROOM and nothing else: never a banking visit's back-off, never elapsed time (Codex r1 BLOCKER 1: a failed visit's rest, and a
 * 30-minute lapse, each sent a kind with room down the well). A kind is thrown only when it is FULL at its cap or no yard stands
 * (room 0). A bag that jams with room in the yard is the bank step's to answer (yardRestMs: it comes back in 2 minutes).
 */
export function wellHold ({ on = true, room = 0 } = {}) {
  return { hold: !!on && Number(room) > 0 }
}
/** A stock visit that placed nothing rests the yard's work for this bot this long -> ms. Pure. With the lanes a bag at 30+ slots
 *  comes back after YARD_JAM_REST_MS (the well is held off its kinds while they have room: the remedy for a full bag is the BANK
 *  step again, soon -- never the well); any other bag, and the old yard: YARD_REST_MS. */
export const YARD_JAM_REST_MS = 2 * 60_000
export const yardRestMs = ({ lanes = LANES, slots = 0 } = {}) => (lanes?.on && Number(slots) >= YARD_URGENT_SLOTS ? YARD_JAM_REST_MS : YARD_REST_MS)
/** WELL_HOLD=off|0|false|no switches the hold off alone (the well as before). Pure. */
export const wellHoldOn = (env = process.env) => !isOffV(env?.WELL_HOLD)
/** `_yard_over_cap` row detail. Pure. */
export const overCapDetail = ({ name = '-', n = 0, lanes = 0, cap = 0, to = 'well' } = {}) => `kind=${name} n=${n} lanes=${lanes}/${cap} to=${to} why=over_cap`
// ---- YARDROW-01 (bagfix-02show (b); OWNER 11-16): THE CHEST ROW FOR WHAT IS NOT A BLOCK ---------------------------------------------
// "can our storage yard have storage for seeds ... clay ... and any other kind of item worth keeping?" Seeds, sugar cane, sticks,
// saplings, iron nuggets, clay balls and snowballs cannot be piled. Each KIND gets ONE CHEST on the yard's rear row (a second when the
// first is full: LANES.rowCap 2), placed by a bot from the chests it carries (188 were carried on 11-16) the first time the kind is
// banked. The cells are the rear floor row's, every OTHER cell (two chests side by side would join and mix two kinds) and never a
// light's. WHICH CHEST IS WHICH KIND is the bots' own record (the town's `yard-row-<home>.json`: cell -> kind): the record is the
// label. A row chest takes its kind only (it is never a general deposit target: skills.mjs townContainers skips it), is a town
// container to the index, the stock view and the withdraw searches, and is banked into by the yard visit's `row` step: whole stacks
// above the bag's keep, then halves (the log halves' move), merging onto what the chest holds. YARD_ROW=off: no row.
export const ROW_KINDS = Object.freeze(['wheat_seeds', 'sugar_cane', 'stick', 'sapling', 'iron_nugget', 'clay_ball', 'snowball'])
/** The row kind a name belongs to -> kind | null. Every sapling and propagule shares one chest. Pure. */
export const rowKindOf = name => (typeof name !== 'string' ? null : /(_sapling|_propagule)$/.test(name) ? 'sapling' : ROW_KINDS.includes(name) ? name : null)
/** What a bag keeps of a row name (the kit: seeds and cane 16 -- bagfix.mjs TRIM_KIT_KEEP -- sticks 8, saplings 4 a species). Pure. */
export const ROW_BAG_KEEP = Object.freeze({ wheat_seeds: 16, sugar_cane: 16, stick: 8, sapling: 4 })
export const rowKeepOf = name => ROW_BAG_KEEP[rowKindOf(name)] ?? 0
/** THE ROW'S CELLS of a yard record -> [[x, y, z]] in order: the rear floor row (v = the footprint's last), every other u from 1, one
 *  above the floor, never a cell the blueprint builds on (a light). Pure. */
export function rowCells (rec, bp) {
  if (!rec || !Array.isArray(rec.anchor) || !Number.isFinite(rec.s) || !rec.orient || !bp?.footprint) return []
  const v = bp.footprint.v - 1
  const built = new Set((bp.cells ?? []).filter(c => c.v === v && c.y >= 1).map(c => c.u))
  const out = []
  for (let u = 1; u < bp.footprint.u - 1; u += 2) {
    if (built.has(u)) continue
    const { dx, dz } = rot(rec.orient, u, v)
    out.push([rec.anchor[0] + dx, rec.s + 1, rec.anchor[1] + dz])
  }
  return out
}
const IS_BOX = /^(chest|trapped_chest|barrel)$/
/**
 * THE ROW STEP'S PLAN -> { bank: [{ kind, at, names: { name: n } }], place: { kind, at } | null, why }. Pure.
 *   held, keeps   the bag { name: n } and its keeps { name: n } (the caller's: rowKeepOf, the goal's wants, the partial-slot rule)
 *   rows          the record [{ at, kind }] over every yard;  cells [{ at, name }] THIS yard's row cells with the block now there
 *                 (null: unread)
 *   full          Set("x,y,z") chests this bot found full;  carried  the chests in the bag;  pressed  the bag is at 30+ slots
 * A kind with LANES.rowMin above its keeps (any surplus when pressed) goes to its first recorded chest that still stands and is not
 * full; with none, and under the cap, ONE chest is placed this visit at this yard's first free cell -- from a bag carrying two or more
 * (one stays: the full-town recovery's) -- and banked into.
 */
export function rowPlan ({ held = {}, keeps = {}, rows = [], cells = [], full = new Set(), carried = 0, pressed = false, lanes = LANES } = {}) {
  const none = why => ({ bank: [], place: null, why })
  if (!lanes?.on || !lanes.row) return none('off')
  const byKind = {}
  for (const [name, n] of Object.entries(held ?? {})) {
    const kind = rowKindOf(name)
    const sur = (Number(n) || 0) - Math.max(0, Number(keeps?.[name] ?? rowKeepOf(name)) || 0)
    if (kind && sur > 0) (byKind[kind] ??= {})[name] = sur
  }
  const key = at => at.join(',')
  const here = new Map(cells.map(c => [key(c.at), c]))
  const stands = r => { const c = here.get(key(r.at)); return !c || c.name == null || IS_BOX.test(c.name) }   // another yard's, or unread: the record's word
  const bank = []
  let place = null
  for (const kind of ROW_KINDS) {
    const names = byKind[kind]
    if (!names) continue
    const total = Object.values(names).reduce((t, v) => t + v, 0)
    if (!(total >= lanes.rowMin || pressed)) continue
    const mine = rows.filter(r => r.kind === kind && stands(r))
    const target = mine.find(r => !full.has(key(r.at)))
    if (target) { bank.push({ kind, at: target.at, names }); continue }
    if (place || mine.length >= lanes.rowCap || !(carried >= 2)) continue
    const taken = new Set(rows.map(r => key(r.at)))
    const free = cells.find(c => !taken.has(key(c.at)) && /^(air|cave_air)$/.test(String(c.name ?? '')))
    if (free) { place = { kind, at: free.at }; bank.push({ kind, at: free.at, names }) }
  }
  return { bank, place, why: bank.length ? 'row' : 'idle' }
}
/** THE STEPS that bank a row chest's names from a bag -> [{ slot, name, count, half?, from? }]. Pure. Whole stacks, smallest first,
 *  while the keep stays; then the stack too big to go whole is HALVED while a half fits above the keep (`halves`: towndeposit.mjs
 *  logHalfSteps) -- one stack of 60 seeds with 16 kept banks 30, then 8 would breach the keep: 30 go, 30 stay. */
export function rowSteps (bag = [], names = {}, keeps = {}, halves = () => []) {
  const out = []
  for (const name of Object.keys(names ?? {}).sort()) {
    const copies = (Array.isArray(bag) ? bag : []).filter(it => it?.name === name && (Number(it.count) || 0) > 0 && Number.isInteger(it.slot))
    const total = copies.reduce((t, it) => t + it.count, 0)
    let room = total - Math.max(0, Number(keeps?.[name] ?? rowKeepOf(name)) || 0)
    const left = []
    for (const it of [...copies].sort((a, b) => a.count - b.count || a.slot - b.slot)) {
      if (it.count > room) { left.push(it); continue }
      out.push({ slot: it.slot, name, count: it.count }); room -= it.count
    }
    for (const st of halves(left, room)) out.push({ ...st, name })
  }
  return out
}
/** The record with a chest's kind written -> rows (a cell is one kind's for good; a second writer of the cell loses). Pure. */
export function rowAssign (rows = [], at, kind, { plot = null, by = null, now = Date.now() } = {}) {
  const k = at.join(',')
  if (rows.some(r => r.at.join(',') === k)) return rows
  return [...rows, { at: [...at], kind, plot, by, t: now }]
}
/** The record less the cells that no longer hold a chest (`gone`: Set("x,y,z"), read from the world) -> rows. Pure. */
export const rowPrune = (rows = [], gone = new Set()) => rows.filter(r => !gone.has(r.at.join(',')))
/** BAGCLEAR (bagfix.mjs BAGCLEAR_UNTIL; owner 11-16: "bank everything bankable to its yard lane or barrel regardless of keeps, and
 *  only today's junk list to the well"): a visit banks up to this much, and the chests keep only this of a lane kind (the build
 *  reserve's cobblestone and logs: stocktarget.mjs BUILD_RESERVE -- a build must not stop on the clear). */
export const CLEAR_VISIT_MAX = 640
export const CLEAR_CHEST_KEEP = Object.freeze({ cobblestone: 256, oak_log: 512, birch_log: 512, spruce_log: 512, jungle_log: 512, acacia_log: 512, dark_oak_log: 512, mangrove_log: 512, cherry_log: 512, sand: 16 })
/** `_yard_lanes` licence row detail (once per spawn). Pure. */
export const lanesModeDetail = (l = LANES) => `on=${l.on ? 1 : 0} start=${l.start} step=${l.step} h=${YARD_H} caps=${Object.entries(l.caps).map(([k, v]) => `${k}:${v}`).join(',')} yards=${yardPlots(l).join('+')} min=${l.min} builders=${l.builders} visitors=${l.visitors} visit_max=${l.visitMax} kinds=${yardKinds(l.on).length} row=${l.on && l.row ? 1 : 0}:${l.rowCap}`.slice(0, 300)

/** THE SWITCH -> bool. YARD=on|off; unset = on only in the pools YARD_POOLS names (default 'showcase'). Pure. */
export function yardOn (env = process.env, pool = '') {
  const v = String(env?.YARD ?? '').trim().toLowerCase()
  if (['on', '1', 'true', 'yes'].includes(v)) return true
  if (['off', '0', 'false', 'no'].includes(v)) return false
  const pools = String(env?.YARD_POOLS ?? 'showcase').split(',').map(s => s.trim()).filter(Boolean)
  return pools.includes(String(pool))
}
/** `_yard_mode` row detail. Pure. */
export const yardModeDetail = (on, size = yardSize()) => `on=${on ? 1 : 0} plot=${YARD_PLOT} blueprint=${YARD_BLUEPRINT} size=${size} builders=${YARD_BUILDERS} h=${YARD_H} bulk=${YARD_BULK.join(',')} bag_keep=${YARD_BAG_KEEP_COBBLE} chest_keep=${YARD_CHEST_KEEP.cobblestone} refill_below=${YARD_REFILL_BELOW} visit_max=${YARD_VISIT_MAX} before_well=${yardFlag(process.env, 'YARD_BEFORE_WELL') ? 1 : 0} draw=${yardFlag(process.env, 'YARD_DRAW') ? 1 : 0}`

// ---- YARDSITE-01 (11-03): WHERE THE YARD GOES ON A CROWDED TOWN -------------------------------------------------------------------
// The showcase offline (11-02, the real siting call): the 18 x 15 yard had no site -- 0 of 31,684 anchor/orient candidates, still 0
// with the sector and door rules dropped and the ring widened to 64: the wall, the paths, the house, the ziggurat's apron and the
// workshop take the town ring (22..44). The yard is the land plan's (landplan.mjs): its sector zones name a `yard` zone (beside
// the store) from the ring road out to workR. So: the yard is sited in the land plan's YARD zone first, then its WILD sectors,
// then a HOMES sector (never farms, the tree farm, the monument or industry), anywhere from the town ring out to YARD_SITE.rMax -- outside the
// wall where the ring is full (the wall opens a gateway where a road crosses it; the proof's walk from town must reach every aisle
// cell, so a site with no road or gate access is refused by the proof itself) -- nearest band first, out to the land plan's workR 80;
// its fill columns may be 4 deep (YARD_SITE.col: the house's 3 refused every showcase candidate, fill_too_deep). No land plan (LANDPLAN=off,
// or a town the keeper has not planned yet): the workshop's sectors (buildsite.mjs projectSectors), as before, over the same bands.
// The caller's zones keep it clear of every reservation: protected zones (the trial chambers), every record + PROJECT_GAP, the
// land plan's road corridors, an unsited copper hall's pad and the expedition markers.
/** The siting bands (Chebyshev from home, the town ring's inner edge; Euclidean out to each band's rMax, nearest first), the
 *  stands' domain margin beyond the band (the visit and the proof stand there), and the town walk's radius margin. */
export const YARD_SITE = Object.freeze({ rMin: 22, bands: [44, 58, 72, 80], standPad: 8, walkPad: 12, col: 4 })
/** The land plan's zone kinds a yard may take, in order (landplan.mjs ZONE_KINDS): its own zone, then wild ground, then a homes
 *  sector (the plan draws two; nothing sites by zone yet). Offline 11-03 on the showcase: the yard zone (E) lies under the taiga
 *  village's protected box (x 49..157), the wild one (N) has one candidate whose pit no stand reaches; the SW homes sector proves. */
export const YARD_ZONES = Object.freeze(['yard', 'wild', 'homes'])
/** THE SIZE (OWNER 11-02, resource-model-1102 Q2: 2x for the fleet) -> 1 | 2 | 'auto'. YARD_SIZE=1|2|auto; unset = auto (2x where it
 *  fits, else 1x: the showcase's crowded town takes 1x unless 2x fits). Pure. */
export function yardSize (env = process.env) {
  const v = String(env?.YARD_SIZE ?? '').trim().toLowerCase()
  return v === '1' ? 1 : v === '2' ? 2 : 'auto'
}
/** The blueprints a size tries, in order. yard@2 is yard@1 with bays twice as long (18 x 26, 656 vs 304 pile slots). Pure. */
export const yardBlueprintsFor = size => (size === 1 ? ['yard@1'] : size === 2 ? ['yard@2'] : ['yard@2', 'yard@1'])
/** Is this a yard blueprint (any size)? Pure. */
export const isYardBlueprint = id => /^yard@\d+$/.test(String(id ?? ''))
/** The earthwork limits for a yard blueprint's floor (yard@1: YARD_EARTH; larger floors scale with their cell count). Pure. */
export const yardEarthFor = bp => {
  const n = Number(bp?.footprint?.u) * Number(bp?.footprint?.v)
  const k = Number.isFinite(n) && n > 270 ? n / 270 : 1
  return Object.freeze({ col: YARD_SITE.col, fill: Math.round(YARD_EARTH.fill * k), cut: Math.round(YARD_EARTH.cut * k) })
}
/** The screen's domain for one band: from the town ring's inner edge (Chebyshev rMin) out to rMax (Euclidean). Pure. */
export const yardDomain = (home, rMax, rMin = YARD_SITE.rMin) => (x, z) => Math.max(Math.abs(x - home.x), Math.abs(z - home.z)) >= rMin && Math.hypot(x - home.x, z - home.z) <= rMax
/** The stands' domain for a yard sited out to rMax (the proof's, the replant's and the visit's: buildsite.mjs stepFor). Pure. */
export const yardStandDomain = (home, rMax) => yardDomain(home, rMax + YARD_SITE.standPad)
/** The town walk's radius for a yard sited out to rMax (buildsite.mjs walkFrom: Chebyshev). Pure. */
export const yardWalkR = rMax => rMax + YARD_SITE.walkPad
/**
 * THE SECTORS TO TRY -> [{ sector, source }]. Pure. `land` the town's land record (its `zones`: { sector: kind }) or null; `fallback`
 * the workshop's sectors (buildsite.mjs projectSectors) used when the land plan names no yard or wild sector.
 */
export function yardSectors (land, fallback = []) {
  const zones = land && typeof land.zones === 'object' && land.zones ? land.zones : null
  if (!zones) return [...fallback]
  const out = []
  for (const kind of YARD_ZONES) for (const [sector, k] of Object.entries(zones)) if (k === kind && !out.some(o => o.sector === sector)) out.push({ sector, source: `land:${kind}` })
  return out.length ? out : [...fallback]
}
/** The nearest band a site's pad lies in (buildsite.mjs screenSite's `pad`: [[x, z]]) -> its index in YARD_SITE.bands (the
 *  bands' count when beyond them all). The siting's rank: nearer bands first, then the earthwork. Pure. */
export function yardBandOf (home, pad = []) {
  const far = pad.reduce((m, [x, z]) => Math.max(m, Math.hypot(x - home.x, z - home.z)), 0)
  const i = YARD_SITE.bands.findIndex(b => far <= b)
  return i < 0 ? YARD_SITE.bands.length : i
}
/**
 * THE SITING PLAN -> [{ blueprint, band, domain, standDomain, walkR, line, earth, sectorBy, rankKey }] in the order to try: each
 * blueprint of the size (2x first under auto), ONE pass over the widest band, its candidates ranked nearest band first
 * (yardBandOf) -- the same order as a pass per band, without screening the inner ring again for each. Pure; `bpOf(id)` loads a
 * blueprint (for its earthwork).
 */
export function yardSitingPlan (home, { size = yardSize(), bpOf = () => null } = {}) {
  const band = YARD_SITE.bands.at(-1)
  return yardBlueprintsFor(size).map(id => ({ blueprint: id, band, domain: yardDomain(home, band), standDomain: yardStandDomain(home, band), walkR: yardWalkR(band), line: band,
    earth: yardEarthFor(bpOf(id)), sectorBy: 'centre', rankKey: site => yardBandOf(home, site.pad) }))
}
/** A sited yard's stands' domain and walk radius for its visits (its record's `band`; an older record without one: the ring's). */
export const yardVisitOpts = (rec, home) => (Number.isFinite(rec?.band) && home ? { domain: yardStandDomain(home, rec.band), walkR: yardWalkR(rec.band) } : {})

const k3 = a => `${a[0]},${a[1]},${a[2]}`
const nm = b => String(b?.name ?? '').replace(/\[.*\]$/, '')
const isAir = b => !!b && /^(air|cave_air|void_air)$/.test(nm(b))

/**
 * THE BAYS' SLOTS of a yard record -> [{ id, slots: [[x, y, z]] }] in FILL order. Pure. `bp` the blueprint (its `bays`: local u/v
 * ranges), `rec` the record (anchor [x, z], orient, s). Layer k covers v from v0 + k - 1 to v1; within a layer the far end (v1)
 * first, then u ascending. The dig order is the reverse.
 */
export function pileSlots (rec, bp, { h = YARD_H, lenOf = null } = {}) {
  if (!rec || !Array.isArray(rec.anchor) || !Number.isFinite(rec.s) || !rec.orient || !Array.isArray(bp?.bays)) return []
  const [ax, az] = rec.anchor
  return bp.bays.map(b => {
    const slots = []
    const [u0, u1] = b.u, v1 = b.v[1]
    // yardlanes-01: a lane shorter than its bay keeps the FAR end (lenOf(id) rows); none given: the whole bay, as before
    const full = b.v[1] - b.v[0] + 1
    const len = typeof lenOf === 'function' ? Math.max(1, Math.min(full, Math.floor(Number(lenOf(b.id)) || full))) : full
    const v0 = v1 - len + 1
    for (let k = 1; k <= h; k++) {
      for (let v = v1; v >= v0 + (k - 1); v--) {
        for (let u = u0; u <= u1; u++) { const { dx, dz } = rot(rec.orient, u, v); slots.push([ax + dx, rec.s + k, az + dz]) }
      }
    }
    return { id: b.id, slots }
  })
}

/**
 * EACH BAY'S STATE from a world read -> [{ id, name, filled, free, next: [[x,y,z]], top: [[x,y,z]], foreign }]. Pure.
 *   name     the bulk name the bay holds (its first filled slot's, in fill order), null when empty
 *   next     the slots a placement may take now, in order: air, with a solid block under it (the floor, or a slot before it in
 *            this list) -- an unread (null) slot ends the list (never a guess)
 *   top      the filled slots a dig may take, highest first: the slot holds the bay's name and the slot above it is air
 *   foreign  slots holding something that is neither air nor the bay's name (never dug by the stock visit: the upkeep's)
 */
export function bayStates (bays = [], read = () => null, { kinds = yardKinds() } = {}) {
  return bays.map(({ id, slots }) => {
    let name = null, filled = 0, foreign = 0
    const blocks = slots.map(s => read(...s))
    for (const b of blocks) { if (b && !isAir(b) && kinds.includes(nm(b))) { name = nm(b); break } }
    const solidAt = new Set()
    for (let i = 0; i < slots.length; i++) {
      const b = blocks[i]
      if (b && !isAir(b)) { if (nm(b) === name) filled++; else foreign++; solidAt.add(k3(slots[i])) }
    }
    const below = s => [s[0], s[1] - 1, s[2]]
    const isFloor = s => !slots.some(q => q[0] === s[0] && q[2] === s[2] && q[1] < s[1])   // layer 1: the floor under it
    const next = []
    for (let i = 0; i < slots.length; i++) {
      const b = blocks[i]
      if (b == null) break
      if (!isAir(b)) continue
      const s = slots[i]
      if (isFloor(s) || solidAt.has(k3(below(s)))) { next.push(s); solidAt.add(k3(s)) }
    }
    const top = []
    for (let i = slots.length - 1; i >= 0; i--) {
      const b = blocks[i]
      if (!b || nm(b) !== name) continue
      const s = slots[i]
      const up = slots.findIndex(q => q[0] === s[0] && q[2] === s[2] && q[1] === s[1] + 1)
      const above = up >= 0 ? blocks[up] : read(s[0], s[1] + 1, s[2])
      if (above && isAir(above)) top.push(s)
    }
    return { id, name, filled, free: next.length, next, top, foreign }
  })
}

/**
 * YARDLANES-01: A YARD'S LANES AS THEY STAND NOW -> [{ id, slots }] (pileSlots' shape). Pure over a world read. Each bay is read whole,
 * and its lane is as long as what stands in it needs (laneLen): 8 rows, then 16, then the bay. An unread bay keeps its whole length
 * (never a guess that hides blocks). Lanes off: the whole bays, as before.
 */
export function laneBays (rec, bp, read = () => null, { lanes = LANES, h = YARD_H } = {}) {
  const whole = pileSlots(rec, bp, { h })
  if (!lanes?.on) return whole
  const len = new Map()
  for (const b of (bp?.bays ?? [])) {
    const bay = whole.find(x => x.id === b.id)
    const full = b.v[1] - b.v[0] + 1, w = b.u[1] - b.u[0] + 1
    let held = 0, unread = false
    for (const sl of (bay?.slots ?? [])) { const x = read(...sl); if (x == null) { unread = true; break } if (!isAir(x)) held++ }
    len.set(b.id, unread ? full : laneLen(held, full, { start: lanes.start, step: lanes.step, w, h }))
  }
  return pileSlots(rec, bp, { h, lenOf: id => len.get(id) })
}
/** THE BAY a name goes to -> a state | null: the bay already holding it with room, else the first empty bay (YARD_BULK's own order
 *  never reserves one). Pure. */
export function bayFor (states = [], name) {
  return states.find(s => s.name === name && s.free > 0) ?? states.find(s => s.name == null && s.foreign === 0 && s.free > 0) ?? null
}
/** What the yard holds of each bulk name -> { name: n }. Pure. */
export const yardHeld = (states = []) => states.reduce((m, s) => (s.name ? { ...m, [s.name]: (m[s.name] ?? 0) + s.filled } : m), {})
/** The room the yard has for a name -> n (its bay's free slots + every empty bay's). Pure. */
export function yardRoomFor (states = [], name, { lanes = LANES, others = {} } = {}) {
  if (!lanes?.on) return states.reduce((t, s) => t + ((s.name === name || (s.name == null && s.foreign === 0)) ? s.free : 0), 0)
  // yardlanes-01: its own lanes' room, and the empty lanes it may still open under its cap (laneMayOpen)
  let room = states.reduce((t, s) => t + (s.name === name ? s.free : 0), 0)
  let mine = states.filter(s => s.name === name).length
  const o = others?.[name] ?? { lanes: 0, room: 0 }
  if (o.room > 0) return room
  for (const s of states) { if (s.name != null || s.foreign !== 0 || !(s.free > 0)) continue; if (mine + o.lanes >= laneCapOf(name, lanes.caps)) break; room += s.free; mine++ }
  return room
}

/**
 * THE BAG'S SURPLUS FOR THE PILES -> { name: n }. Pure over the bag's counts { name: n }. The cobble family above
 * YARD_BAG_KEEP_COBBLE (cobblestone kept first, so the deepslate goes before it), every bamboo_block, and nothing else.
 */
export function bagSurplus (held = {}, { lanes = LANES, keeps = null } = {}) {
  const n = k => Math.max(0, Number(held?.[k]) || 0)
  const out = {}
  // yardlanes-01: every lane kind above the bag's keep of it (`keeps`: the caller's floors -- towndeposit.mjs townKeeps with the
  // partial-slot rule; none given: cobblestone 64 and nothing else kept)
  if (lanes?.on) {
    for (const k of LANE_KINDS) { const sur = n(k) - Math.max(0, Number((keeps ?? { cobblestone: 64 })[k]) || 0); if (sur > 0) out[k] = sur }
    return out
  }
  let keep = YARD_BAG_KEEP_COBBLE
  const keepC = Math.min(n('cobblestone'), keep); keep -= keepC
  const keepD = Math.min(n('cobbled_deepslate'), keep)
  if (n('cobblestone') - keepC > 0) out.cobblestone = n('cobblestone') - keepC
  if (n('cobbled_deepslate') - keepD > 0) out.cobbled_deepslate = n('cobbled_deepslate') - keepD
  if (n('bamboo_block') > 0) out.bamboo_block = n('bamboo_block')
  return out
}
/** Bamboo blocks to craft from the bag -> n (whole blocks of the bamboo above YARD_BAMBOO_KEEP). Pure. */
export const bambooBlocks = (held = {}) => Math.floor(Math.max(0, (Number(held?.bamboo) || 0) - YARD_BAMBOO_KEEP) / BAMBOO_PER_BLOCK)

/**
 * THE VISIT'S WORK -> { kind: 'stock' | 'clerk' | 'refill' | 'upkeep' | null, urgent, place: { name: n }, draw: { name: n },
 * dig: { name: n }, why }. Pure. In order: a bag surplus of a whole stack the piles have room for (urgent when the bag is under
 * pressure); the town's chests above their keep (the clerk: drawn into the bag, then placed); a town below its refill line with
 * cobblestone on the piles (dug back, then banked); aisle clutter. Each bounded by YARD_VISIT_MAX.
 *   held      the bag { name: n };  slots  the bag's used slots;  freeSlots  its free slots
 *   town      the town index's stock { name: n } (null: unknown -- no clerk and no refill on a guess)
 *   states    bayStates;  clutter  the aisle cells to clear (yardClutter);  pick  the bag holds a usable pickaxe (a refill's tool)
 */
export function yardWork ({ held = {}, slots = 0, freeSlots = 36, town = null, states = [], clutter = [], pick = true, bayClutter = [], deferred = false, lanes = LANES, keeps = null, others = {}, first = true, noRefill = false, clear = false } = {}) {
  const sur = bagSurplus(held, { lanes, keeps })
  const place = {}
  // bagclear (BAGCLEAR_UNTIL, the one-time clear; `clear`): the per-visit limit is lifted (CLEAR_VISIT_MAX) and any surplus banks
  let left = lanes?.on ? (clear ? CLEAR_VISIT_MAX : lanes.visitMax) : YARD_VISIT_MAX
  for (const name of yardKinds(!!lanes?.on)) {
    const want = Math.min(sur[name] ?? 0, yardRoomFor(states, name, { lanes, others }), left)
    if (want > 0) { place[name] = want; left -= want }
  }
  const placed = Object.values(place).reduce((t, v) => t + v, 0)
  // yarduse-01: a bag whose cobble the WELL left for the yard (`deferred`) is under pressure whatever its slots
  const pressed = slots >= YARD_URGENT_SLOTS || !!deferred
  // yarduse-01: a BAY BLOCKED by clutter (LIVE showcase 11-04: 5 spruce leaves on bay 3's top layer locked its 76 slots for 26 h)
  // is cleared FIRST when the room the bag's surplus finds is short of a stack -- the visit then stocks what the clearing opened
  const surplus = Object.values(sur).reduce((t, v) => t + v, 0)
  // yardlanes-01: a bag banks on ANY town visit once it holds LANES.min above its keeps (was a whole stack, or a pressed bag)
  const stockMin = lanes?.on ? (clear ? 1 : Math.min(YARD_STOCK_MIN, lanes.min)) : YARD_STOCK_MIN
  if (bayClutter.length && placed < stockMin) return { kind: 'upkeep', urgent: pressed && surplus > 0, first: true, place: {}, draw: {}, dig: {}, why: `bay_clutter:${bayClutter.length}` }
  // yardlanes-01 (a): with the lanes a stock is the bot's FIRST work at town whatever its project (`urgent`: activeProject's repair loop,
  // bounded by its back-off) -- banking never waits for the yard to be the bot's project; the visit itself is bounded (LANES.passMs)
  if (placed >= stockMin || (placed > 0 && pressed)) return { kind: 'stock', urgent: pressed || !!lanes?.on, place, draw: {}, dig: {}, why: `bag_surplus:${placed}` }
  // the clerk and the refill are the FIRST yard's (the town's chests against the cobblestone pile)
  if (first && town && typeof town === 'object') {
    const draw = {}
    let room = Math.min(left, Math.max(0, Number(freeSlots) || 0) * 64)
    // cobblestone only (Claude r1 BLOCK 2): the build reserve has no cobbled_deepslate key, so the withdraw takes none of it
    // (mats.mjs takeAllowed); a deepslate clerk would draw nothing every visit
    // bagclear: during the one-time clear the clerk moves EVERY lane kind out of the chests (owner 11-12: no stone or logs in chests),
    // down to nothing but the build reserve's own floor (the withdraw's: skills.mjs); otherwise cobblestone above its chest keep, as before
    for (const name of (clear && lanes?.on ? yardKinds(true) : ['cobblestone'])) {
      const over = Math.max(0, (Number(town[name]) || 0) - (clear && lanes?.on ? (CLEAR_CHEST_KEEP[name] ?? 0) : YARD_CHEST_KEEP[name]))
      const want = Math.min(over, yardRoomFor(states, name, { lanes, others }), room)
      if (want > 0) { draw[name] = want; room -= want }
    }
    const drawn = Object.values(draw).reduce((t, v) => t + v, 0)
    if (drawn >= YARD_STOCK_MIN) return { kind: 'clerk', urgent: false, place: { ...draw }, draw, dig: {}, why: `chests_over:${drawn}`, ...(clear && lanes?.on ? { clear: true } : {}) }
    const inYard = yardHeld(states).cobblestone ?? 0
    const short = YARD_REFILL_BELOW - (Number(town.cobblestone) || 0)
    // a refill digs stone: without a pickaxe a dug cobblestone drops NOTHING (Codex r1 BLOCK: the stock would be destroyed)
    // refill-01 (`noRefill`): the piles are not dug back to hold a chest target nobody draws against (owner 11-16: no stocking for stock)
    if (!noRefill && short > 0 && inYard > 0 && freeSlots >= 1 && pick) {
      const dig = Math.min(short, inYard, YARD_REFILL_MAX, Math.max(0, Number(freeSlots) || 0) * 64)
      if (dig > 0) return { kind: 'refill', urgent: false, place: {}, draw: {}, dig: { cobblestone: dig }, why: `chests_short:${short}` }
    }
  }
  if (clutter.length) return { kind: 'upkeep', urgent: false, place: {}, draw: {}, dig: {}, why: `clutter:${clutter.length}` }
  return { kind: null, urgent: false, place: {}, draw: {}, dig: {}, why: 'idle' }
}

/**
 * THE PILE CELLS a placement plan becomes -> { cells: [{ at, role, seg }], palette: { role: [name] }, bays: { name: id } }. Pure.
 * Each name's next slots in its bay (bayFor, then the next empty bay when that one fills), role `pile_<name>`, one segment `pile`.
 */
export function pileCells (states = [], place = {}, { lanes = LANES, others = {}, skip = null } = {}) {
  const cells = [], palette = {}, bays = {}, lanesUsed = {}
  const used = new Set()
  const st = states.map(s => ({ ...s, next: s.next.slice() }))
  for (const name of yardKinds(!!lanes?.on)) {
    let n = Math.max(0, Number(place?.[name]) || 0)
    while (n > 0) {
      // yardlanes-01: `skip` (a lane another bot holds) is never this visit's; an empty lane only under the kind's cap (laneMayOpen)
      const mine = s => !(skip?.has?.(s.id))
      const b = st.find(s => s.name === name && s.next.length && mine(s)) ?? (laneMayOpen(st, name, { lanes, others }) ? st.find(s => s.name == null && s.foreign === 0 && s.next.length && !used.has(s.id) && mine(s)) : null)
      if (!b) break
      if (b.name == null) { b.name = name; used.add(b.id) }
      const take = b.next.splice(0, n)
      for (const at of take) cells.push({ at, role: `pile_${name}`, seg: 'pile' })
      palette[`pile_${name}`] = [name]
      bays[name] = b.id
      ;(lanesUsed[name] ??= []).includes(b.id) || lanesUsed[name].push(b.id)
      n -= take.length
    }
  }
  return { cells, palette, bays, lanes: lanesUsed }
}

/**
 * THE PILE CELLS A VISIT MAY PLACE, UNDER ITS LANES' LEASES -> { pc, leased: [id] }. Pure but for `tryLease(id) -> bool` (the caller's:
 * one lease a lane on the yard's record). Every lane the plan uses is leased first; a lane another bot holds is skipped and the plan
 * made again without it; a lane the SECOND plan opens that is held too ends the visit's stocking (never a third plan). EVERY path that
 * places on the piles goes through here (Codex r1 BLOCKER 6: the upkeep's clear-then-stock placed with no lease). Lanes off: the plan
 * as it is, no lease (the old yard's one visitor).
 */
export function leasedPileCells (states = [], place = {}, opts = {}, tryLease = () => true) {
  const lanes = opts?.lanes ?? LANES
  let pc = pileCells(states, place, opts)
  if (!lanes?.on || !pc.cells.length) return { pc, leased: [] }
  const leased = []
  const lease = id => { if (leased.includes(id)) return true; let ok = false; try { ok = !!tryLease(id) } catch { ok = false } if (ok) leased.push(id); return ok }
  const idsOf = p => [...new Set(Object.values(p.lanes ?? {}).flat())]
  const busy = new Set(idsOf(pc).filter(id => !lease(id)))
  if (busy.size) {
    pc = pileCells(states, place, { ...opts, skip: busy })
    if (idsOf(pc).some(id => !lease(id))) pc = { ...pc, cells: [] }
  }
  return { pc, leased }
}
/** THE REFILL'S PICKAXE from the bag's items ({ name, uses left }) -> the item | null: a pickaxe with at least 2 uses left, the
 *  cheapest tier first (wooden, stone, then the rest), so the iron pickaxe a miner needs is the last spent. Pure: `left(item)` the
 *  uses left (toolfor.mjs remaining). */
const PICK_RANK = ['wooden_pickaxe', 'stone_pickaxe', 'golden_pickaxe', 'iron_pickaxe', 'diamond_pickaxe', 'netherite_pickaxe']
export function refillPick (items = [], left = () => 0) {
  const ok = (Array.isArray(items) ? items : []).filter(i => PICK_RANK.includes(i?.name) && Number(left(i)) >= 2)
  return ok.sort((a, b) => PICK_RANK.indexOf(a.name) - PICK_RANK.indexOf(b.name) || Number(left(b)) - Number(left(a)))[0] ?? null
}
/** The dig-back entries for a refill -> [{ at, kind: 'tidy', name }] (runVisit's `tidy`: highest first). Pure. */
export function refillDigs (states = [], dig = {}) {
  const out = []
  for (const [name, n0] of Object.entries(dig ?? {})) {
    let n = Math.max(0, Number(n0) || 0)
    for (const s of states.filter(q => q.name === name)) {
      for (const at of s.top) { if (n <= 0) break; out.push({ at, kind: 'tidy', name }); n-- }
    }
  }
  return out
}

/**
 * YARDUSE-01: THE BAYS' CLUTTER -> [{ at, kind: 'tidy', name }]. Pure. Every pile slot holding something that is neither air, a
 * bulk block (stock, whatever bay it is in, is never dug as clutter) nor a kept thing (KEEP_IN_AISLE: lights, containers, beds,
 * signs, liquids, portals): leaves, a sapling, grass, snow, dirt, a stray stone. An empty bay with any of it is never given to a
 * name (bayFor / yardRoomFor need foreign === 0), so this is what makes it usable again. Highest first (a leaf on the top layer
 * before what is under it); an unread slot is skipped; at most `max`.
 */
export function bayClutter (bays = [], read = () => null, { max = YARD_CLEAR_MAX, kinds = yardKinds() } = {}) {
  const out = []
  for (const { slots } of bays ?? []) {
    for (const s of slots ?? []) {
      const b = read(...s)
      if (!b) continue
      const n = nm(b)
      if (kinds.includes(n) || KEEP_IN_AISLE.test(n)) continue
      out.push({ at: s, kind: 'tidy', name: n })
    }
  }
  return out.sort((a, b) => b.at[1] - a.at[1]).slice(0, max)
}

/** Never cleared from an aisle: air, the lights, containers, beds, signs (anything a player put there to keep). */
const KEEP_IN_AISLE = /^(air|cave_air|torch|wall_torch|lantern|chest|trapped_chest|barrel|.*shulker_box|.*_bed|.*_sign|.*_wall_sign|water|lava|fire|soul_fire|bubble_column|bedrock|barrier|.*portal.*|light)$/
/**
 * THE AISLE CLUTTER -> [{ at, kind: 'tidy', name }]. Pure. Every cell one and two above the floor's AISLE cells (the record's
 * `base` cells: the floor outside the bays) holding anything but air, a light or a kept thing -- leaves, saplings, grass, flowers,
 * snow, a stray crafting table, a pillar -- at most YARD_CLEAR_MAX, highest first. An unread cell is skipped.
 */
export function yardClutter (rec, read = () => null, { max = YARD_CLEAR_MAX } = {}) {
  const out = []
  for (const c of rec?.cells ?? []) {
    if (c.role !== 'base') continue
    for (const dy of [2, 1]) {
      const at = [c.at[0], c.at[1] + dy, c.at[2]]
      const b = read(...at)
      if (!b) continue
      const n = nm(b)
      if (KEEP_IN_AISLE.test(n)) continue
      out.push({ at, kind: 'tidy', name: n })
    }
  }
  return out.sort((a, b) => b.at[1] - a.at[1]).slice(0, max)
}

/** `_yard` row detail (the read's lines: kind, placed / dug, the yard's holdings after). Pure. */
export function yardRowDetail ({ kind = '-', why = '-', placed = {}, dug = {}, drew = {}, banked = {}, crafted = 0, held = {}, stop = '-', cleared = 0 } = {}) {
  const f = m => Object.entries(m ?? {}).filter(([, v]) => v > 0).map(([k, v]) => `${k}:${v}`).join(',') || '-'
  return `kind=${kind} why=${why} placed=${f(placed)} drew=${f(drew)} dug=${f(dug)} banked=${f(banked)} bamboo_blocks=${crafted} cleared=${cleared} yard=${f(held)} stop=${String(stop).replace(/\s+/g, '_').slice(0, 40)}`.slice(0, 300)
}

// ---- YARDUSE-01 (11-04): THE YARD BEFORE THE WELL, AND THE CONSUMERS DRAW FROM IT ------------------------------------------------
// OWNER 11-04 "we built a large area outside the town to put excess materials, it seems to have been built but doesnt seem to be
// used, why?". MEASURED (showcase, 15 bots, 48 h 11-02 12:56Z..11-04 12:56Z, 374,125 skill rows; the world read by RCON): the yard
// filled in 2 h 11 min on 11-03 (227 cobblestone, 07:11-09:22Z) and stood full for 26 h -- bay 3's 76 slots locked by 5 spruce
// leaves on its top layer that the aisle-only upkeep never reached; nothing ever drew from the piles (the refill waits for chests
// below 256 and they sat at 788-1000); and the junk well took 9,066 cobble in 28 visits (2,893 of it while the yard had room)
// against the yard's 584. So: the well leaves the yard's share in the bag while the yard can take it (yardWellKeep, bounded by
// yardDeferOk), the bays' clutter is the upkeep's (bayClutter), and a sink's or the groundskeeper's bill draws cobblestone from the
// piles before the chests (yardDrawPlan; skills.mjs yardDrawFor). Yard full: the well as before (owner 11-02 Q1).
/** A deferral the yard did not answer (no stock visit since) holds no second one for this long. */
export const YARD_DEFER_MS = 30 * 60_000
/** The yard room worth keeping cobble back from the well for (a smaller room is the well's, as before). */
export const YARD_WELL_MIN = 16
/** A draw smaller than this is not worth the walk to the yard (the chests serve it). */
export const YARD_DRAW_MIN = 16
/** A consumer's draw is bounded to this long, and only taken when its own visit has YARD_DRAW_LEFT_MS left. */
export const YARD_DRAW_MS = 60_000
/** A draw digs at most this many (Claude code r1 BLOCKER: a dug pile block drops ON the pile, out of the aisle's pickup reach --
 *  every drop is walked to after the digs, so a draw is sized to what that collection can cover). */
export const YARD_DRAW_MAX = 32
/** THE COLLECTION AFTER A DIG-BACK -> go on? Pure. `drops` the yard's cobblestone drops still on the ground near the piles, `iter`
 *  sweeps done, `gained` what the last sweep put in the bag, `idle` sweeps in a row that gained nothing, `left` ms to the deadline. */
export const YARD_COLLECT_SWEEPS = 8
export const collectMore = ({ drops = 0, iter = 0, idle = 0, left = 0 } = {}) => drops > 0 && iter < YARD_COLLECT_SWEEPS && idle < 2 && left > 3_000
export const YARD_DRAW_LEFT_MS = 100_000
/** THE SWITCHES -> bool. YARD_BEFORE_WELL=off keeps the well as before; YARD_DRAW=off keeps the consumers' bills on the chests. Pure. */
export const yardFlag = (env = process.env, name) => !['off', '0', 'false', 'no'].includes(String(env?.[name] ?? '').trim().toLowerCase())
/** Is this bot's last deferral still unanswered (inside YARD_DEFER_MS, no stock visit since)? Pure. */
export const yardDeferred = ({ deferAt = null, stockAt = null, now = Date.now() } = {}) => Number.isFinite(deferAt) && now - deferAt < YARD_DEFER_MS && !(Number(stockAt) > deferAt)
/** May the well defer to the yard now? Pure: not while an earlier deferral is unanswered (the remedy for a yard visit that never
 *  comes is the well itself, half an hour later -- a bag is never held full on the yard's promise). */
export const yardDeferOk = o => !yardDeferred(o)
/**
 * WHAT THE WELL LEAVES IN THE BAG FOR THE YARD -> the cobble family the bag keeps at the well (0: the well's own reserve, as
 * before). Pure. `room` the yard's room for cobblestone now (yardRoomFor over a fresh read; 0 when unread, resting or not built),
 * `deferOk` yardDeferOk. The yard's stock visit takes the bag's surplus above YARD_BAG_KEEP_COBBLE, at most YARD_VISIT_MAX a visit,
 * so that much is kept above it.
 */
export function yardWellKeep ({ on = true, room = 0, deferOk = true } = {}) {
  const r = Math.max(0, Number(room) || 0)
  if (!on || !deferOk || r < YARD_WELL_MIN) return 0
  return YARD_BAG_KEEP_COBBLE + Math.min(r, YARD_VISIT_MAX)
}
/**
 * A CONSUMER'S DRAW FROM THE PILES -> cobblestone to dig back for a bill. Pure. `need` the bill's cobblestone still wanted from
 * town (after the bag's spare), `held` the yard's holdings (yardHeld), `freeSlots` the bag's, `pick` a usable pickaxe (a
 * cobblestone dug by hand drops nothing), `left` the visit's time left (ms). 0: the chests serve the bill, as before.
 */
export function yardDrawPlan ({ on = true, need = 0, held = {}, freeSlots = 0, pick = false, left = Infinity } = {}) {
  if (!on || !pick || !(Number(left) >= YARD_DRAW_LEFT_MS)) return 0
  const n = Math.min(Math.max(0, Number(need) || 0), Math.max(0, Number(held?.cobblestone) || 0), YARD_DRAW_MAX, Math.max(0, Number(freeSlots) || 0) * 64)
  return n >= YARD_DRAW_MIN ? n : 0
}
