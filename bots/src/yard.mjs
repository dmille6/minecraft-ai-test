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
export const yardModeDetail = on => `on=${on ? 1 : 0} plot=${YARD_PLOT} blueprint=${YARD_BLUEPRINT} builders=${YARD_BUILDERS} h=${YARD_H} bulk=${YARD_BULK.join(',')} bag_keep=${YARD_BAG_KEEP_COBBLE} chest_keep=${YARD_CHEST_KEEP.cobblestone} refill_below=${YARD_REFILL_BELOW} visit_max=${YARD_VISIT_MAX}`

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
export function yardWork ({ held = {}, slots = 0, freeSlots = 36, town = null, states = [], clutter = [], pick = true } = {}) {
  const sur = bagSurplus(held)
  const place = {}
  let left = YARD_VISIT_MAX
  for (const name of YARD_BULK) {
    const want = Math.min(sur[name] ?? 0, yardRoomFor(states, name), left)
    if (want > 0) { place[name] = want; left -= want }
  }
  const placed = Object.values(place).reduce((t, v) => t + v, 0)
  if (placed >= YARD_STOCK_MIN || (placed > 0 && slots >= YARD_URGENT_SLOTS)) return { kind: 'stock', urgent: slots >= YARD_URGENT_SLOTS, place, draw: {}, dig: {}, why: `bag_surplus:${placed}` }
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
