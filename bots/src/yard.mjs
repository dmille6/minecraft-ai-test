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
export function pileSlots (rec, bp, { h = YARD_H } = {}) {
  if (!rec || !Array.isArray(rec.anchor) || !Number.isFinite(rec.s) || !rec.orient || !Array.isArray(bp?.bays)) return []
  const [ax, az] = rec.anchor
  return bp.bays.map(b => {
    const slots = []
    const [u0, u1] = b.u, [v0, v1] = b.v
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
export function bayStates (bays = [], read = () => null) {
  return bays.map(({ id, slots }) => {
    let name = null, filled = 0, foreign = 0
    const blocks = slots.map(s => read(...s))
    for (const b of blocks) { if (b && !isAir(b) && YARD_BULK.includes(nm(b))) { name = nm(b); break } }
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

/** THE BAY a name goes to -> a state | null: the bay already holding it with room, else the first empty bay (YARD_BULK's own order
 *  never reserves one). Pure. */
export function bayFor (states = [], name) {
  return states.find(s => s.name === name && s.free > 0) ?? states.find(s => s.name == null && s.foreign === 0 && s.free > 0) ?? null
}
/** What the yard holds of each bulk name -> { name: n }. Pure. */
export const yardHeld = (states = []) => states.reduce((m, s) => (s.name ? { ...m, [s.name]: (m[s.name] ?? 0) + s.filled } : m), {})
/** The room the yard has for a name -> n (its bay's free slots + every empty bay's). Pure. */
export const yardRoomFor = (states = [], name) => states.reduce((t, s) => t + ((s.name === name || (s.name == null && s.foreign === 0)) ? s.free : 0), 0)

/**
 * THE BAG'S SURPLUS FOR THE PILES -> { name: n }. Pure over the bag's counts { name: n }. The cobble family above
 * YARD_BAG_KEEP_COBBLE (cobblestone kept first, so the deepslate goes before it), every bamboo_block, and nothing else.
 */
export function bagSurplus (held = {}) {
  const n = k => Math.max(0, Number(held?.[k]) || 0)
  const out = {}
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
export function yardWork ({ held = {}, slots = 0, freeSlots = 36, town = null, states = [], clutter = [], pick = true, bayClutter = [], deferred = false } = {}) {
  const sur = bagSurplus(held)
  const place = {}
  let left = YARD_VISIT_MAX
  for (const name of YARD_BULK) {
    const want = Math.min(sur[name] ?? 0, yardRoomFor(states, name), left)
    if (want > 0) { place[name] = want; left -= want }
  }
  const placed = Object.values(place).reduce((t, v) => t + v, 0)
  // yarduse-01: a bag whose cobble the WELL left for the yard (`deferred`) is under pressure whatever its slots
  const pressed = slots >= YARD_URGENT_SLOTS || !!deferred
  // yarduse-01: a BAY BLOCKED by clutter (LIVE showcase 11-04: 5 spruce leaves on bay 3's top layer locked its 76 slots for 26 h)
  // is cleared FIRST when the room the bag's surplus finds is short of a stack -- the visit then stocks what the clearing opened
  const surplus = Object.values(sur).reduce((t, v) => t + v, 0)
  if (bayClutter.length && placed < YARD_STOCK_MIN) return { kind: 'upkeep', urgent: pressed && surplus > 0, first: true, place: {}, draw: {}, dig: {}, why: `bay_clutter:${bayClutter.length}` }
  if (placed >= YARD_STOCK_MIN || (placed > 0 && pressed)) return { kind: 'stock', urgent: pressed, place, draw: {}, dig: {}, why: `bag_surplus:${placed}` }
  if (town && typeof town === 'object') {
    const draw = {}
    let room = Math.min(left, Math.max(0, Number(freeSlots) || 0) * 64)
    // cobblestone only (Claude r1 BLOCK 2): the build reserve has no cobbled_deepslate key, so the withdraw takes none of it
    // (mats.mjs takeAllowed); a deepslate clerk would draw nothing every visit
    for (const name of ['cobblestone']) {
      const over = Math.max(0, (Number(town[name]) || 0) - YARD_CHEST_KEEP[name])
      const want = Math.min(over, yardRoomFor(states, name), room)
      if (want > 0) { draw[name] = want; room -= want }
    }
    const drawn = Object.values(draw).reduce((t, v) => t + v, 0)
    if (drawn >= YARD_STOCK_MIN) return { kind: 'clerk', urgent: false, place: { ...draw }, draw, dig: {}, why: `chests_over:${drawn}` }
    const inYard = yardHeld(states).cobblestone ?? 0
    const short = YARD_REFILL_BELOW - (Number(town.cobblestone) || 0)
    // a refill digs stone: without a pickaxe a dug cobblestone drops NOTHING (Codex r1 BLOCK: the stock would be destroyed)
    if (short > 0 && inYard > 0 && freeSlots >= 1 && pick) {
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
export function pileCells (states = [], place = {}) {
  const cells = [], palette = {}, bays = {}
  const used = new Set()
  const st = states.map(s => ({ ...s, next: s.next.slice() }))
  for (const name of YARD_BULK) {
    let n = Math.max(0, Number(place?.[name]) || 0)
    while (n > 0) {
      const b = st.find(s => s.name === name && s.next.length) ?? st.find(s => s.name == null && s.foreign === 0 && s.next.length && !used.has(s.id))
      if (!b) break
      if (b.name == null) { b.name = name; used.add(b.id) }
      const take = b.next.splice(0, n)
      for (const at of take) cells.push({ at, role: `pile_${name}`, seg: 'pile' })
      palette[`pile_${name}`] = [name]
      bays[name] = b.id
      n -= take.length
    }
  }
  return { cells, palette, bays }
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
export function bayClutter (bays = [], read = () => null, { max = YARD_CLEAR_MAX } = {}) {
  const out = []
  for (const { slots } of bays ?? []) {
    for (const s of slots ?? []) {
      const b = read(...s)
      if (!b) continue
      const n = nm(b)
      if (YARD_BULK.includes(n) || KEEP_IN_AISLE.test(n)) continue
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
