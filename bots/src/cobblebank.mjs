// COBBLEBANK-01 (OWNER 11-04 "do the surplus cobble fix"; part (b) is the owner's cobbleoverflow-01: 10-16 "yes, junk can take
// the extra", re-approved 10-28, ledger row cobbleoverflow-01). Every decision is a pure function here; skills.mjs,
// towndeposit.mjs, bankable.mjs and cognitive.mjs wire them. COBBLEBANK=off is the one-setting rollback (today's rules exactly).
//
// MEASURED 11-04 (80 bots, newest inventory per bot): cobble above each bot's 64 reserve filled 411 bag slots, 16.8% of all
// occupied slots; 79 of 80 bots held more than 64 (median 346). A successful town_deposit freed a median of 1 slot, because the
// visit banked at most CREDIT_CAP (64) of each name -- one stack of cobblestone, one of cobbled_deepslate -- and the not-full
// visit's tail (junkout-01) banked no cobble at all. 82 of 247 `_cobble_bank` rows hit `no_room`.
//
// (a) THE BANK: on a town visit (the full-bag town deposit AND the not-full tail), EVERY whole cobble stack above the bag's
//     reserve (bankable.mjs COBBLE_RESERVE 64, the two names together) is planned, not one per name. Nothing else changes: the
//     town cap (cobblecap.mjs, 1000) still admits each stack under the town's lock, the stockpile keep (townKeeps, 64 of the
//     stone family) and every withdraw hold still apply, and the deposit verb's transfer re-chooses the same stacks.
// (b) THE WELL BELOW THE CAP: when the town's containers have no room for a whole stack -- PROVEN town-wide (every container
//     the cap's own scan lists is either found without room by this very run or remembered `full` by the town's memory), with
//     the town's cobble counted, below the cap and at or above its working-stock reserve (stocktarget BUILD_RESERVE
//     cobblestone 256) -- the full-bag junk well takes the surplus whole stacks above the bag's 64, exactly the stacks it
//     takes at the cap (well.mjs cobbleWellStacks). Never a chest's cobble (bags only: prune is untouched), never at the
//     not-full visit (towngate-01's lane), never a prune visit, never while a withdraw holds cobble, never on evidence older
//     than NOROOM_TTL_MS or older than any newer non-`full` outcome in the town's memory (memoryChangeAt), never another town's.

// A LEAF (no imports): bankable.mjs imports this module, so the two cobble names are bankable.mjs COBBLE_NAMES, copied (a
// cycle otherwise), and the town reserve is stocktarget.mjs's owner table value, copied (mats-01 is that table's only reader:
// matset.test); cobblebank.test asserts both equal their sources.

/** THE SWITCH, read LIVE from the env at every use (a test scene can turn it off around one run; a bot's env never changes). */
export const COBBLEBANK = Object.freeze({ get on () { return String(process.env.COBBLEBANK ?? '').trim().toLowerCase() !== 'off' } })
/** The visit's per-name cobble credit cap before this change (towndeposit.mjs CREDIT_CAP, bankable.mjs creditCap default). */
export const OLD_COBBLE_VISIT_CAP = 64
/** No-room evidence is trusted this long (a visit's stay; another bot's withdrawal can make room at any time). */
export const NOROOM_TTL_MS = 10 * 60 * 1000
/** The town's working stock of cobble (the owner's BUILD_RESERVE, marks-01's LOW): below it a stack waits for room. */
export const NOROOM_TOWN_RESERVE = 256
export const BANK_COBBLE_NAMES = Object.freeze(['cobblestone', 'cobbled_deepslate'])
const COB = new Set(BANK_COBBLE_NAMES)
export const isBankCobble = name => COB.has(name)

/** THE VISIT'S PER-NAME COBBLE CAP -> Infinity (every whole stack above the reserve) when on, else the old 64. Pure. */
export function cobbleVisitCap (on = COBBLEBANK.on) {
  return on ? Infinity : OLD_COBBLE_VISIT_CAP
}

/**
 * MAY THE WELL TAKE THIS BAG'S SURPLUS COBBLE BELOW THE CAP? THE TOWN-WIDE NO-ROOM VERDICT -> { ok, why, unseen }. Pure.
 *   left        whole cobble stacks the run's own plan still holds after its transfers (planned AND admitted by the cap)
 *   capRefused  { at_cap, unknown, outside }: stacks the cap refused in the transfer (then the cap, not room, kept them)
 *   keys        every town container the cap's scan lists (skills.mjs townCobbleScan), `coverage` its completeness
 *   fullKeys    the keys found WITHOUT ROOM: this run's containers that ended full (`full`, `took_some`) and the town memory's
 *               `full` (chestfull.mjs containerStatus, its own FULL_TTL_MS)
 *   town, complete  the town's counted cobble (cobblecap lb) and whether the count is complete
 * ok only when ALL of: on; left > 0; no cap refusal; a covered scan with >= 1 container; every key without room; a complete
 * count at or above `reserve`. `unseen` = keys not proven full (the read's exposure figure).
 */
export function noRoomVerdict ({ on = COBBLEBANK.on, left = 0, capRefused = null, keys = [], coverage = false, fullKeys = [], town = null, complete = false, reserve = NOROOM_TOWN_RESERVE } = {}) {
  const ks = [...new Set(Array.isArray(keys) ? keys : [])]
  const full = new Set(Array.isArray(fullKeys) ? fullKeys : fullKeys instanceof Set ? [...fullKeys] : [])
  const unseen = ks.filter(k => !full.has(k)).length
  const no = why => ({ ok: false, why, unseen })
  if (!on) return no('off')
  if (!(Number(left) > 0)) return no('nothing_left')
  const cr = capRefused ?? {}
  if ((Number(cr.at_cap) || 0) + (Number(cr.unknown) || 0) + (Number(cr.outside) || 0) > 0) return no('cap_refused')
  if (!coverage || !ks.length) return no('town_unscanned')
  if (unseen > 0) return no('town_has_room')
  if (!complete || town == null || !Number.isFinite(Number(town))) return no('town_uncounted')
  if (Number(town) < reserve) return no('below_reserve')
  return { ok: true, why: 'no_room', unseen: 0 }
}

/**
 * WHEN DID THE TOWN'S MEMORY LAST RECORD ANYTHING BUT `full`? -> a time, or -Infinity. Pure over chestfull.mjs's entries
 * ({ key: { o, at } }; item-miss maps carry no `o` and are skipped). The evidence's invalidation: a container that `took`
 * items (room), or any other newer outcome (unknown, unavailable -- which can OVERWRITE a `took`: Codex r1), ends it, so a
 * later overwrite never revives evidence an earlier `took` had ended.
 */
export function memoryChangeAt (entries = {}) {
  let t = -Infinity
  for (const e of Object.values(entries && typeof entries === 'object' ? entries : {})) {
    if (!e || typeof e.o !== 'string' || e.o === 'full') continue
    const at = Number(e.at)
    if (Number.isFinite(at) && at > t) t = at
  }
  return t
}

/** IS THE NO-ROOM EVIDENCE STILL GOOD? -> boolean. Pure. `flag` { at }; `roomAt` the town memory's newest non-`full` outcome
 *  (memoryChangeAt). */
export function noRoomLive (flag, now = Date.now(), roomAt = -Infinity, ttl = NOROOM_TTL_MS) {
  const at = Number(flag?.at)
  if (!Number.isFinite(at)) return false
  if (!(now - at < ttl) || now < at) return false
  return !(Number(roomAt) > at)
}

/**
 * THE FULL-BAG WELL'S COBBLE MODE -> 'at_cap' | 'no_room' | the cap's own answer. Pure. `cap` is skills.mjs cobbleWellCap
 * (cobblecap.mjs wellCobbleSwitch: 'at_cap' | 'below' | 'unknown' | 'held' | 'none'), read now. AT THE CAP stonecap's rule
 * wins unchanged; 'no_room' only from 'below' (a complete count under the cap, no withdraw hold, surplus held) with live
 * evidence (noRoomLive) and the town still at or above its reserve now.
 */
export function wellCobbleMode ({ on = COBBLEBANK.on, cap = 'unknown', live = false, town = null, reserve = NOROOM_TOWN_RESERVE } = {}) {
  if (!on || cap !== 'below' || !live) return cap   // 'at_cap' (stonecap's rule) and every other answer pass through unchanged
  if (town == null || !Number.isFinite(Number(town)) || Number(town) < reserve) return cap
  return 'no_room'
}
/** May the full-bag well take cobble in this mode? */
export const wellTakesCobble = mode => mode === 'at_cap' || mode === 'no_room'

/** The `_cobblebank phase=bank` row: one per town deposit run that held surplus cobble. Pure; key=value, under 300. */
export function bankRowDetail ({ mode = 'full', before = 0, after = 0, planned = 0, plannedOld = 0, banked = 0, items = 0, slotsBefore = 0, slotsAfter = 0, verdict = null } = {}) {
  const v = verdict ? ` noroom=${verdict.ok ? 1 : 0} why=${verdict.why} unseen=${verdict.unseen ?? '-'}` : ''
  return `phase=bank mode=${mode} cobble_before=${before} cobble_after=${after} planned=${planned} planned_old=${plannedOld} banked_stacks=${banked} banked=${items} slots=${slotsBefore}->${slotsAfter} freed=${Math.max(0, slotsBefore - slotsAfter)}${v}`.slice(0, 300)
}
/** The `_cobblebank phase=well` row: one per full-bag well visit that threw cobble BELOW the cap (mode no_room). Pure. `freed` = the
 *  whole cobble stacks clicked (a whole stack is one slot); `slots` the visit's bag before and after (other junk included). */
export function wellRowDetail ({ stacks = 0, items = 0, left = null, town = null, age = null, slotsBefore = null, slotsAfter = null, names = '' } = {}) {
  // freed = the whole cobble stacks this lane threw (one slot each); slots= is the whole visit's bag (other junk too)
  const freed = stacks
  return `phase=well why=no_room stacks=${stacks} items=${items} left=${left ?? '-'} town=${town ?? '-'} reserve=${NOROOM_TOWN_RESERVE} age_s=${age == null ? '-' : Math.round(age / 1000)} slots=${slotsBefore ?? '-'}->${slotsAfter ?? '-'} freed=${freed}${names ? ` names=${names}` : ''}`.slice(0, 300)
}
/** The `_cobblebank_mode` licence row, once per spawn. */
export const cobbleBankModeDetail = (on = COBBLEBANK.on) => `phase=mode on=${on ? 1 : 0} visit_cap=${on ? 'all' : OLD_COBBLE_VISIT_CAP} tail=${on ? 1 : 0} noroom_ttl_s=${NOROOM_TTL_MS / 1000} reserve=${NOROOM_TOWN_RESERVE}`
