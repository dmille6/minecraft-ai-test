// BUILDFIRST-01SHOW (item 10, control 11-18; docs/reports/buildvisit-2026-11-18.md). OWNER 11-18: "fixing bugs but never making much
// project building or visable work".
//
// THE CASE (LIVE showcase 11-18 00:00-12:40Z, 13 bots): 772 of 787 build visits were the tidy and none a building. Three causes in
// series: (1) the mine crew's idle steer only ever ordered the grounds (minecrew.mjs crewSteer); (2) the build order's own pick was
// refused for bag room (shop.mjs: 8 free slots) on every bot -- 13 of 13 bags at ~35/36 -- and the room bank (bagroom.mjs) moves no
// cobble, so it freed one slot and stopped (69 of 72 `_room_bank then=stop`); (3) a pick refused before its visit is never stamped
// (projturn's turnBegin), so the same plot (house1, a complete house's reroof: a repair) won every 10 minutes for every bot.
//
// THE RULE (pure here; skills.mjs wires it):
//   BUILDING FIRST: an idle bot at the surface is sent to the build order's own pick when that pick is a building visit the order
//   would issue now (its back-offs, holds, turns and slots all as the order reads them) -- else to the grounds, as before. After
//   BUILDFIRST.run building orders in a row the next idle order is the grounds' (the clean-up never starves).
//   ROOM: a building pick refused for room is given a remedy the bot performs: the room bank when it alone reaches the room, else
//   a WELL TRIP (cobblestone and cobbled_deepslate above the yard's bag keep, whole stacks, only kinds the yard cannot take a stack
//   of) when the well is alive for this bot and bank + well reach the room; then the build in the same visit.
//   ROOM HOLD: no remedy reaches the room (or the trip ended short) -> that plot steps aside for this bot ROOM_HOLD_MS (shop.mjs
//   WAIT_STOPS `room`), so the order's next pick is the next project and one plot cannot hold every bot's order.
// BUILDFIRST=off restores every line (no building look, no well trip, no room hold).

const isOff = v => ['off', '0', 'false', 'no'].includes(String(v ?? '').trim().toLowerCase())
const num = (v, d, lo, hi) => { const n = Number(String(v ?? '').trim()); return String(v ?? '').trim() !== '' && Number.isFinite(n) && n >= lo && n <= hi ? Math.floor(n) : d }
/** THE SWITCHES -> { on, run, holdMs, wellRestMs }. Pure. */
export function buildFirstSettings (env = {}) {
  return Object.freeze({
    on: !isOff(env?.BUILDFIRST),
    run: num(env?.BUILDFIRST_RUN, 2, 1, 20),                         // building orders in a row before one grounds order
    holdMs: num(env?.BUILDFIRST_HOLD_MIN, 10, 1, 120) * 60_000,      // the room hold
    wellRestMs: num(env?.BUILDFIRST_WELL_REST_MIN, 30, 1, 240) * 60_000,   // a well this bot could not use is not asked again this long
  })
}
export const BUILDFIRST = buildFirstSettings(typeof process !== 'undefined' ? process.env : {})

/** The names a room trip may throw: the cobble family only (the owner's over-cap stone). Nothing else, ever. */
export const ROOM_WELL_NAMES = Object.freeze(['cobblestone', 'cobbled_deepslate'])
/** The bag keeps this much of the family on a room trip (the stockpile rung's 64; replay 11-18: 128 left 30% more bots short). */
export const ROOM_WELL_KEEP = 64   // control 11-18: 64 on room trips only (the yard's own bag keep stays 128); the well's own floor (well.mjs COBBLE_WELL_RESERVE)
/** At most this many whole stacks a trip (well.mjs MAX_STACKS_PER_VISIT). */
export const ROOM_WELL_MAX_STACKS = 9
/** A kind the yard can still take a whole stack of is the yard's, never the well's (the owner's cap: store what has a home). */
export const ROOM_WELL_YARD_MIN = 64

/**
 * THE ROOM TRIP'S STACKS -> { stacks: [{ slot, name, count }], slots }. Pure over mineflayer Items. Whole stacks of the family,
 * smallest first, while the family keeps `keep` and only of a name whose yard room is under ROOM_WELL_YARD_MIN; it stops as soon as
 * the bag would have `need` free slots (it throws what the room needs, not everything), and at `maxStacks`.
 *   freeSlots  the bag's free slots now        plus  slots another step of the same visit frees first (the room bank's)
 *   yardRoom(name) -> blocks the yard's lanes can still take of `name` (throws: the yard's -- nothing thrown of it)
 */
export function roomWellStacks (items = [], { need = 8, freeSlots = 0, plus = 0, keep = ROOM_WELL_KEEP, maxStacks = ROOM_WELL_MAX_STACKS, yardRoom = () => 0 } = {}) {
  const open = name => { try { return Number(yardRoom(name)) < ROOM_WELL_YARD_MIN } catch { return false } }
  const list = (Array.isArray(items) ? items : []).filter(it => it && ROOM_WELL_NAMES.includes(it.name) && (Number(it.count) || 0) > 0 && Number.isInteger(it.slot))
  let left = list.reduce((t, it) => t + (Number(it.count) || 0), 0)
  let free = (Number(freeSlots) || 0) + (Number(plus) || 0)
  const out = []
  for (const it of [...list].sort((a, b) => a.count - b.count || a.slot - b.slot)) {
    if (free >= need || out.length >= maxStacks) break
    if (!open(it.name)) continue
    if (left - it.count < keep) continue
    out.push({ slot: it.slot, name: it.name, count: it.count }); left -= it.count; free++
  }
  return { stacks: out, slots: out.length }
}

/**
 * THE YARD'S SHARE OF THE BAG -> slots a stock trip could free. Pure. Whole stacks of the family above `keep` of a kind the yard can
 * take a stack of (`yardRoom(name) >= ROOM_WELL_YARD_MIN`), bounded by that room and by the yard visit's own `visitMax` blocks.
 */
export function roomYardSlots (items = [], { keep = ROOM_WELL_KEEP, yardRoom = () => 0, visitMax = 128 } = {}) {
  const fam = (Array.isArray(items) ? items : []).filter(it => it && ROOM_WELL_NAMES.includes(it.name) && (Number(it.count) || 0) > 0)
  let left = fam.reduce((t, it) => t + it.count, 0), budget = Math.max(0, Number(visitMax) || 0), n = 0
  const room = {}
  for (const name of ROOM_WELL_NAMES) { try { room[name] = Math.max(0, Number(yardRoom(name)) || 0) } catch { room[name] = 0 } }
  for (const it of [...fam].sort((a, b) => a.count - b.count)) {
    if (room[it.name] < ROOM_WELL_YARD_MIN || left - it.count < keep || it.count > budget || it.count > room[it.name]) continue
    left -= it.count; budget -= it.count; room[it.name] -= it.count; n++
  }
  return n
}
/**
 * WHICH ROOM REMEDY -> 'bank' | 'yard' | 'well' | null. Pure. The bank when it alone reaches the room (as before); else the YARD (the
 * owner's order: the piles take the stone they have room for) when it frees a slot; else the well trip when the well is alive for
 * this bot and bank + well reach the room; else none (the order skips `room` and the plot is held).
 */
export function roomRoute ({ need = 8, freeSlots = 0, bankSlots = 0, yardSlots = 0, wellSlots = 0, wellOk = false } = {}) {
  const f = Number(freeSlots) || 0, b = Math.max(0, Number(bankSlots) || 0), w = Math.max(0, Number(wellSlots) || 0)
  if (f >= need) return null
  if (b >= 1 && f + b >= need) return 'bank'
  if ((Number(yardSlots) || 0) >= 1) return 'yard'
  if (wellOk && w >= 1 && f + b + w >= need) return 'well'
  return null
}

/** The well refusals that make the well unusable for THIS bot for a while (a dead or unreachable well never loops). */
export const WELL_DEAD_STOPS = Object.freeze(['no_well', 'breached', 'unknown', 'no_facing', 'unreachable', 'inside', 'server_unanswered', 'short'])
/** IS THE WELL ALIVE FOR THIS BOT NOW? -> bool. Pure over its last dead stop { stop, at }. */
export const wellAlive = (last = null, now = Date.now(), B = BUILDFIRST) => !(last && WELL_DEAD_STOPS.includes(last.stop) && Number.isFinite(last.at) && now - last.at < B.wellRestMs && now >= last.at)

/** IS THIS build_shop ORDER A BUILDING VISIT (not the grounds', an expedition, a share bank or a room fallback to the tidy)? Pure. */
export function buildingOrder (order) {
  if (!order || order.skill !== 'build_shop') return false
  const a = order.args ?? {}
  return a.grounds !== true && a.expedition !== true && a.shareBank !== true && a.why !== 'room_fallback'
}

/**
 * THE IDLE BOT'S ORDER -> { order, why, run }. Pure. `look()` lazy -> the order the build order would issue now (cooldown aside) or
 * null; `run` the building orders this bot was given in a row. After B.run of them the grounds take the next idle order.
 */
export function idleBuild ({ on = BUILDFIRST.on, run = 0, look = () => null, B = BUILDFIRST } = {}) {
  if (!on) return { order: null, why: 'off', run: 0 }
  if ((Number(run) || 0) >= B.run) return { order: null, why: 'grounds_turn', run: 0 }
  let o = null
  try { o = look() } catch { o = null }
  if (!buildingOrder(o)) return { order: null, why: 'no_building', run: 0 }
  return { order: o, why: 'building', run: (Number(run) || 0) + 1 }
}

/** THE SLOTS CLAY COMPACTION FREES -> n. Pure. `n` clay balls, crafted 4 : 1 into clay blocks (compact.mjs RECIPES): the balls' slots
 *  less the blocks' and the remainder's. Needs one free slot for the product (compact.mjs bagCompact), which the caller checks. */
export function claySlotsSaved (n = 0) {
  const k = Math.max(0, Math.floor(Number(n) || 0))
  if (k < 4) return 0
  const blocks = Math.floor(k / 4), rest = k % 4
  return Math.max(0, Math.ceil(k / 64) - Math.ceil(blocks / 64) - (rest ? 1 : 0))
}
/** `_room_well` row detail. Pure. */
/** `_room_yard` row detail. Pure. */
export const roomYardDetail = ({ plot = '-', need = 8, slotsBefore = '-', slotsAfter = '-', stocked = {}, then = '-', stop = null } = {}) =>
  `plot=${plot} need=${need} slots=${slotsBefore}->${slotsAfter} cobblestone=${stocked.cobblestone ?? 0} cobbled_deepslate=${stocked.cobbled_deepslate ?? 0} then=${then}${stop ? ` stop=${stop}` : ''}`.slice(0, 300)
export const roomWellDetail = ({ plot = '-', need = 8, planned = 0, slotsBefore = '-', slotsAfter = '-', thrown = {}, then = '-', stop = null } = {}) =>
  `plot=${plot} need=${need} planned=${planned} slots=${slotsBefore}->${slotsAfter} cobblestone=${thrown.cobblestone ?? 0} cobbled_deepslate=${thrown.cobbled_deepslate ?? 0} then=${then}${stop ? ` stop=${stop}` : ''}`.slice(0, 300)
