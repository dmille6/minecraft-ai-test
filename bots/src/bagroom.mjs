// BAGROOM-01: A BUILDER'S BAG MAKES ROOM FOR THE BUILD ORDER IT IS REFUSED FOR (showcase; docs: the scfix audit 11-06).
//
// MEASURED (showcase, 15 bots, 11-05 00:00Z..11-06 01:30Z, 513,505 skill rows): 865 `_shop_skip why=room` rows (the build order's
// SHOP_BAG_SLOTS_MIN = 8 free slots, shop.mjs buildOrder). 777 of the 865 (89.8%) were at 29-33 occupied slots -- the band between
// the build's room rule (<= 28) and the junk well's dispose order (well.mjs wellOrder: TRIGGER_SLOTS = 34). Those bags held 436
// cobble on average (6+ whole stacks above the well's 64), and the town refused their cobble at its cap (`_stock_refused
// ...cobble_cap` 702 rows): at the cap only the well relieves a bag, and the well waited for 34 slots. The junkout-01 visit order
// fires below 34 but throws listed junk only (no cobble at the cap). Two correct guards composed into a dead band.
// The other half of those bags is the copper hall's own DRAWN SHARES (shop.mjs shareState): of the bags' 373 stone bricks and
// ~1,200 planks, 317 bricks and ~1,000 planks were per-bot hall shares (project-0_70_0.hall.drawn.<bot>.json, 11-06 01:30Z) left
// by visits that ended `aborted interrupted` (no bank-back). A share is spendable only by its holder's next visit, and that
// visit is the one the room rule refuses.
//
// THE REMEDIES, both executable at town where the refusal is made:
//   WELL   (BAGROOM_WELL) the junk well's dispose order is also due when the bag is short of the build's room (freeSlots <
//          BUILD_ROOM_SLOTS) and holds a whole stack the well may take (listed junk, swords, and -- only with the town PROVEN at its
//          cobble cap -- cobble above the bot's own 64: the existing at-cap plan, unchanged). wellRoomDue.
//   SHARE  (BAGROOM_SHARE) the build order's room refusal, when the bag holds a drawn share of whole stacks, becomes a share-bank
//          visit instead: the share is banked into the workshop's materials chests first (shopchest-01: the chests every visit
//          draws from first, no reserve), then the town's containers, and the drawn record is reduced by what went. The bricks
//          and planks then serve every builder with room, not one bag. shareBankPlan.
// BAGROOM=off is the rollback of both; BAGROOM_WELL=off / BAGROOM_SHARE=off of each. Unset: on only in BAGROOM_POOLS (default
// 'showcase'). Pure module: no imports of shop.mjs (well.mjs imports this; shop.mjs reaches well.mjs).

/** shop.mjs SHOP_BAG_SLOTS_MIN, restated (a cycle otherwise): bagroom.test.mjs holds the two equal. */
export const BUILD_ROOM_SLOTS = 8
/** One share-bank visit per bot at most this often (a bank that freed nothing is not retried at once). */
export const SHARE_BANK_EVERY_MS = 20 * 60_000
/** A share is banked only when it holds at least this many whole slots (a part-stack share frees nothing). */
export const SHARE_BANK_MIN_SLOTS = 1

const onOff = v => {
  const s = String(v ?? '').trim().toLowerCase()
  if (['on', '1', 'true', 'yes'].includes(s)) return true
  if (['off', '0', 'false', 'no'].includes(s)) return false
  return null
}
/** THE SWITCHES -> { on, well, share }. Pure. */
export function bagRoomSwitches (env = process.env, pool = '') {
  const pools = String(env?.BAGROOM_POOLS ?? 'showcase').split(',').map(s => s.trim()).filter(Boolean)
  const on = onOff(env?.BAGROOM) ?? pools.includes(String(pool))
  // batch-14c release (coordinator 11-06, the owner's stoneworks plan): the WELL half is OFF unless BAGROOM_WELL=on -- the band's early
  // dispose throws away cobble the stoneworks smelts; the share banking stays on
  return { on, well: on && onOff(env?.BAGROOM_WELL) === true, share: on && onOff(env?.BAGROOM_SHARE) !== false }
}
export const BAGROOM = Object.freeze(bagRoomSwitches(typeof process !== 'undefined' ? process.env : {}, typeof process !== 'undefined' ? (process.env.MEMORY_POOL ?? '') : ''))
/** `_bagroom_mode` row detail (once per spawn). Pure. */
export const bagRoomModeDetail = (sw = BAGROOM) => `on=${sw.on ? 1 : 0} well=${sw.well ? 1 : 0} share=${sw.share ? 1 : 0} room=${BUILD_ROOM_SLOTS} every_min=${SHARE_BANK_EVERY_MS / 60_000} min_slots=${SHARE_BANK_MIN_SLOTS}`

/**
 * IS THE WELL'S DISPOSE ORDER DUE FOR THE BUILD'S ROOM? -> bool. Pure. `freeSlots` the bag's, `junkStacks` the whole stacks the
 * well's own plan would throw (well.mjs disposePlan: cobble only at the proven cap). Off: false (the 34-slot rule alone, as before).
 */
export function wellRoomDue ({ on = BAGROOM.well, freeSlots = 36, junkStacks = 0 } = {}) {
  return !!on && Number(freeSlots) < BUILD_ROOM_SLOTS && Number(junkStacks) > 0
}

const slotsOf = (n, stack = 64) => Math.floor((Number(n) || 0) / stack)
/**
 * THE SHARE BANK -> { ok, why, names: { name: n }, slots }. Pure. `shares` [{ plot, share: { name: n } }] (shareState's held
 * shares, already clamped to the bag); `stackOf(name)` the name's stack size (64 default). ok only when switched on, the bag is
 * short of the build's room, the last bank is SHARE_BANK_EVERY_MS old, and the shares hold SHARE_BANK_MIN_SLOTS whole stacks.
 * `names` is every share's names summed (the visit banks each share against its own record).
 */
export function shareBankPlan ({ on = BAGROOM.share, shares = [], freeSlots = 36, now = 0, lastAt = null, every = SHARE_BANK_EVERY_MS, stackOf = () => 64 } = {}) {
  if (!on) return { ok: false, why: 'off', names: {}, slots: 0 }
  if (!(Number(freeSlots) < BUILD_ROOM_SLOTS)) return { ok: false, why: 'room_ok', names: {}, slots: 0 }
  if (Number.isFinite(lastAt) && now - lastAt < every) return { ok: false, why: 'recent', names: {}, slots: 0 }
  const names = {}
  for (const s of Array.isArray(shares) ? shares : []) for (const [n, c] of Object.entries(s?.share ?? {})) if ((Number(c) || 0) > 0) names[n] = (names[n] ?? 0) + Number(c)
  const slots = Object.entries(names).reduce((t, [n, c]) => t + slotsOf(c, stackOf(n) || 64), 0)
  if (!Object.keys(names).length) return { ok: false, why: 'no_share', names: {}, slots: 0 }
  if (slots < SHARE_BANK_MIN_SLOTS) return { ok: false, why: 'part_stacks', names, slots }
  return { ok: true, why: 'share', names, slots }
}

/** `_share_bank` row detail. Pure. `per` [{ plot, banked: {name: n}, left: {name: n} }]. */
export function shareBankDetail ({ per = [], slotsBefore = '-', slotsAfter = '-', stop = 'done' } = {}) {
  const m = o => Object.entries(o ?? {}).filter(([, v]) => v > 0).map(([k, v]) => `${k}:${v}`).join(',') || '-'
  const parts = (Array.isArray(per) ? per : []).map(p => `${p.plot}=${m(p.banked)}/left=${m(p.left)}`)
  return `slots=${slotsBefore}->${slotsAfter} stop=${stop} ${parts.join(' ') || 'none'}`.slice(0, 290)
}
