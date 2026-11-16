// BAGFIX-01 (bagfix-01show; OWNER 11-16 "lets stop everything right now, and focus on the bag and chest fix"). PURE, and a LEAF (no
// imports): the switches and every decision of the piece; skills.mjs, shop.mjs, towndeposit.mjs, well.mjs and chestfull.mjs wire them.
//
// MEASURED (showcase, 14 bots, 6 h to 11-16 ~18:00Z): build_shop 169 runs, 7% success -- 47 "the room bank moved nothing (no town chest
// within reach now ...)", 12 "(the town chests in reach are full ...)"; deposit 54 runs, 33% success; bags at 34+ kinds; 188 chests
// carried while the town refused "at its chest limit". Read in the code (the design note of 11-16):
//   A  REACH  the room bank asked on the BAG alone and walked to the NEAREST chest of the 16-block box, whatever the town's memory said
//             of it (full, unusable) and whatever its lid -- then the town deposit refused that very chest. The sorted hall's 18 chests
//             (registered: chestfull.mjs inTownExtra) were never a target. Now: the walk's target is a chest the deposit would accept,
//             the hall's included, and with none there is no ask (the refusal goes on to B).
//   B  LIGHT  a room refusal with 2-7 free slots sends ANY bot to the tidy when it has work (gkroom-01 sent only the keeper off the forest).
//   C  TRIM   (below) the partial-slot rule, the owner's trim list, the kit keeps, the nuggets' exit, the one-time clear.
//   D  CHEST  (below) carried chests are placed and banked; one unreadable container defers nothing.
// SWITCHES, each default ON; off|0|false|no restores that part exactly as it was: BAGFIX (all), BAGFIX_REACH, BAGFIX_LIGHT, BAGFIX_TRIM,
// BAGFIX_CHEST, BAGFIX_MERGE. BAGCLEAR_UNTIL (an ISO time or epoch ms; unset = off): the one-time clear, while it lasts.

const isOff = v => ['off', '0', 'false', 'no'].includes(String(v ?? '').trim().toLowerCase())
/** A time setting -> epoch ms | null (unset, unreadable). Pure. */
export function untilOf (raw) {
  const s = String(raw ?? '').trim()
  if (!s) return null
  const n = /^[0-9]+$/.test(s) ? Number(s) : Date.parse(s)
  return Number.isFinite(n) && n > 0 ? n : null
}
/** THE SWITCHES -> { on, reach, light, trim, chest, merge, clearUntil }. Pure. */
export function bagfixSwitches (env = {}) {
  const on = !isOff(env?.BAGFIX)
  const part = k => on && !isOff(env?.[k])
  return { on, reach: part('BAGFIX_REACH'), light: part('BAGFIX_LIGHT'), trim: part('BAGFIX_TRIM'), chest: part('BAGFIX_CHEST'), merge: part('BAGFIX_MERGE'),
           clearUntil: on ? untilOf(env?.BAGCLEAR_UNTIL) : null }
}
export const BAGFIX = Object.freeze(bagfixSwitches(typeof process !== 'undefined' ? process.env : {}))
/** Is the one-time clear running now? Pure. */
export const clearActive = (sw = BAGFIX, now = Date.now()) => Number.isFinite(sw?.clearUntil) && now < sw.clearUntil

// ---- A: THE ROOM BANK'S TARGET -----------------------------------------------------------------------------------------------------
/** The town memory's statuses the town deposit skips (skills.mjs townContainers; chestfull.mjs containerStatus). */
export const SKIPPED_STATUS = Object.freeze(['full', 'unavailable', 'unusable', 'backoff'])
/** The room bank walks at most this far to its target, and for at most this long (the hall stands in the town ring, 17..72 of home). */
export const ROOM_REACH_R = 64
export const ROOM_REACH_WALK_MS = 40_000
/** The base's walk bound (bagfull-01), restated for the off switch. */
export const ROOM_BASE_WALK_MS = 20_000
/** A target scan is reused this long (the ask runs in the decision loop). */
export const ROOM_SCAN_MS = 30_000

/** Is a container at `q` the town deposit's? -> bool. Pure. `inBox` the 16-block town box, `extra` a registered container (the hall's
 *  and the cottages': chestfull.mjs inTownExtra). Off: the box alone, as before. */
export const depositZone = ({ reach = BAGFIX.reach, inBox = false, extra = false } = {}) => !!inBox || (!!reach && !!extra)

/**
 * THE ROOM BANK'S TARGET -> the candidate | null. Pure. `cands` [{ at, d, inBox, extra, status, lid }]: `d` the bot's distance, `status`
 * the town memory's word (containerStatus), `lid` true when a solid block shuts the chest. On: the nearest the town deposit would
 * accept (in its zone, not skipped by the memory, lid clear) within ROOM_REACH_R. Off: the nearest of the box, whatever its state.
 */
export function roomTarget (cands = [], { reach = BAGFIX.reach, maxD = ROOM_REACH_R } = {}) {
  const list = (Array.isArray(cands) ? cands : []).filter(c => c && Number.isFinite(c.d))
  const near = (a, b) => a.d - b.d
  if (!reach) return list.filter(c => c.inBox).sort(near)[0] ?? null
  return list.filter(c => depositZone({ reach, inBox: c.inBox, extra: c.extra }) && !SKIPPED_STATUS.includes(c.status) && !c.lid && c.d <= maxD).sort(near)[0] ?? null
}
/** MAY THE ROOM BANK BE ASKED? -> bool. Pure. On: only with a target (a chest in reach already, or one to walk to). Off: always (the bag
 *  alone decided). */
export const roomAskTarget = ({ reach = BAGFIX.reach, inReach = false, target = null } = {}) => !reach || !!inReach || !!target
/** The room-bank visit's stop, for its row -> a word. Pure. */
export function roomStop ({ status = null, inReach = false, target = null, arrived = false, detail = '' } = {}) {
  if (status === 'success') return 'banked'
  if (!inReach && !target) return 'no_target'
  if (!inReach && !arrived) return 'walk_short'
  const d = String(detail ?? '')
  if (/no town chest within reach/.test(d)) return 'none_in_reach'
  if (/in reach are full/.test(d)) return 'full'
  if (/nothing to bank/.test(d)) return 'nothing_to_bank'
  return 'not_banked'
}
/** `near=` for the row: the target's distance and where it is. Pure. */
export const roomNear = ({ inReach = false, target = null } = {}) => (inReach ? 'reach' : target ? `${Math.round(target.d)}:${target.extra && !target.inBox ? 'hall' : 'box'}` : '-')

/** `_bagfix` licence row detail (once per spawn). Pure. */
export function bagfixModeDetail (sw = BAGFIX, now = Date.now()) {
  const b = v => (v ? 1 : 0)
  return `on=${b(sw.on)} reach=${b(sw.reach)} light=${b(sw.light)} trim=${b(sw.trim)} chest=${b(sw.chest)} merge=${b(sw.merge)} clear=${b(clearActive(sw, now))}` +
    ` clear_until=${Number.isFinite(sw.clearUntil) ? new Date(sw.clearUntil).toISOString() : '-'} reach_r=${ROOM_REACH_R} walk_s=${ROOM_REACH_WALK_MS / 1000}`
}
