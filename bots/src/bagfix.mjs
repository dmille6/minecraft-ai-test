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

// ---- M: A DEPOSIT MERGES INTO THE PARTIAL STACKS A CHEST ALREADY HOLDS -------------------------------------------------------------
// LIVE 11-16 20:01Z (the town index): 33 containers, 867 of 891 slots used, 30 completely full -- of FRAGMENTS: moss_block 410 items in
// 93 slots, coal 325 in 53, cobbled_deepslate 945 in 31, spruce_log 414 in 25, sugar_cane 270 in 16. The town deposit moved a stack
// only into an EMPTY slot (towndeposit.mjs fitToContainer; Codex review 1 P1: a stack whose components differ swaps on the server while
// the client believes it merged), so every fragment cost a slot and a town with room for thousands of items refused everything.
// NOW a stack goes onto the partial stacks of the SAME item first (sameStack: name, type, metadata, nbt and components equal -- the
// case the server merges), each click read back from the cursor (it must hold exactly the rest), and what is left into an empty slot.
// A step is planned only when ALL of it fits, so each still frees one bag slot. BAGFIX_MERGE=off: empty slots only, as before.
/** A stack is put onto at most this many partial stacks (one click each). */
export const MERGE_MAX = 3
const J = v => { try { return JSON.stringify(v ?? null) } catch { return '!' } }
/** Would the server MERGE these two stacks? -> bool. Pure over mineflayer Items. Anything it cannot compare is not the same. */
export function sameStack (a, b) {
  if (!a || !b || typeof a.name !== 'string' || a.name !== b.name) return false
  if ((a.type ?? null) !== (b.type ?? null) || (a.metadata ?? 0) !== (b.metadata ?? 0)) return false
  return J(a.nbt) === J(b.nbt) && J(a.components ?? []) === J(b.components ?? []) && J(a.removedComponents ?? []) === J(b.removedComponents ?? [])
}
/**
 * WHERE EACH STACK GOES -> the steps that WHOLLY fit, in order, each with `merges` [{ dest, n }] (partial stacks of the same item, in
 * slot order, at most MERGE_MAX) and `dest` (an empty slot for what is left, or null when the merges take it all). Pure.
 *   slots    the container's slots: Item | null
 *   stackOf  (name) -> its stack size;  same(slotItem, step) -> would they merge
 * Off: empty slots only -- towndeposit.mjs fitToContainer's answer exactly (every `merges` empty).
 */
export function mergeFit (steps = [], slots = [], { merge = BAGFIX.merge, stackOf = () => 64, same = (slot, step) => slot?.name === step?.name } = {}) {
  const list = Array.isArray(slots) ? slots : []
  const cnt = list.map(x => (x ? Number(x.count) || 0 : 0))
  const free = []
  for (let i = 0; i < list.length; i++) if (!list[i]) free.push(i)
  const out = []
  for (const step of (Array.isArray(steps) ? steps : [])) {
    let left = Number(step?.count) || 0
    const merges = []
    const max = Number(stackOf(step?.name)) || 64
    if (merge && max > 1) {
      for (let i = 0; i < list.length && left > 0 && merges.length < MERGE_MAX; i++) {
        if (!list[i] || cnt[i] >= max || !same(list[i], step)) continue
        const n = Math.min(left, max - cnt[i])
        merges.push({ dest: i, n }); left -= n
      }
    }
    if (left > 0 && !free.length) continue   // not all of it fits: nothing of it moves (a part moved frees no bag slot)
    for (const m of merges) cnt[m.dest] += m.n
    out.push({ ...step, dest: left > 0 ? free.shift() : null, merges })
  }
  return out
}
/** DOES THE SERVER'S SLOT HOLD A MOVE? -> bool. Pure. `d` the destination slot at the verifying re-open; `x` the move { step, after,
 *  grew }: a stack put into an empty slot that nothing was merged onto reads back EXACTLY (as before); a merge, or a slot merged onto
 *  later in the run, holds at least the count the move left there. */
export function destHolds (d, x) {
  if (!d || !x?.step || d.name !== x.step.name) return false
  if (x.after == null && !x.grew) return d.count === x.step.count
  return d.count >= (x.after ?? x.step.count)
}
/** THE ROOM A CONTAINER'S PARTIAL STACKS HAVE for these names -> items. Pure. `names` the town index's observation ({ name: [count,
 *  slots] }); `want` the names a plan would bank. */
export function mergeRoom (names = {}, want = [], stackOf = () => 64) {
  let n = 0
  for (const w of new Set(Array.isArray(want) ? want : [])) {
    const e = names?.[w]
    if (!Array.isArray(e)) continue
    const max = Number(stackOf(w)) || 64
    if (max > 1) n += Math.max(0, (Number(e[1]) || 0) * max - (Number(e[0]) || 0))
  }
  return n
}
/** MAY A CONTAINER THE TOWN REMEMBERS `full` STILL BE TRIED? -> bool. Pure. Only `full` (no empty slot), never unavailable / unusable /
 *  backoff, and only with room on its partial stacks for a whole stack's worth of something the plan banks. */
export const fullStillTakes = ({ merge = BAGFIX.merge, status = null, room = 0, least = 1 } = {}) => !!merge && status === 'full' && Number(room) >= Math.max(1, Number(least) || 1)

/** `_bagfix` licence row detail (once per spawn). Pure. */
export function bagfixModeDetail (sw = BAGFIX, now = Date.now()) {
  const b = v => (v ? 1 : 0)
  return `on=${b(sw.on)} reach=${b(sw.reach)} light=${b(sw.light)} trim=${b(sw.trim)} chest=${b(sw.chest)} merge=${b(sw.merge)} clear=${b(clearActive(sw, now))}` +
    ` clear_until=${Number.isFinite(sw.clearUntil) ? new Date(sw.clearUntil).toISOString() : '-'} reach_r=${ROOM_REACH_R} walk_s=${ROOM_REACH_WALK_MS / 1000}`
}
