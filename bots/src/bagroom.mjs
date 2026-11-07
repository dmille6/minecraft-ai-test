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
  // bagfull-01: the ROOM BANK half (BAGROOM_BANK=off its own rollback) is on wherever bagroom is
  return { on, well: on && onOff(env?.BAGROOM_WELL) === true, share: on && onOff(env?.BAGROOM_SHARE) !== false, bank: on && onOff(env?.BAGROOM_BANK) !== false }
}
export const BAGROOM = Object.freeze(bagRoomSwitches(typeof process !== 'undefined' ? process.env : {}, typeof process !== 'undefined' ? (process.env.MEMORY_POOL ?? '') : ''))
/** `_bagroom_mode` row detail (once per spawn). Pure. */
export const bagRoomModeDetail = (sw = BAGROOM) => `on=${sw.on ? 1 : 0} well=${sw.well ? 1 : 0} share=${sw.share ? 1 : 0} bank=${sw.bank ? 1 : 0} room=${BUILD_ROOM_SLOTS} every_min=${SHARE_BANK_EVERY_MS / 60_000} min_slots=${SHARE_BANK_MIN_SLOTS} bank_every_min=${ROOM_BANK_EVERY_MS / 60_000}`

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

// ================================================================================================================================
// BAGFULL-01: THE ROOM BANK -- a full bag at town banks what no build needs, then builds (showcase; control session 11-07).
//
// MEASURED (showcase, 15 bots, 24 h to 11-07 13:00Z, 255,666 skill rows): `_shop_skip why=room` 442 rows from 14 bots (one per bot
// per 30 min: a lower bound), 396 of 412 sampled inside the town, at 5-7 free slots (real, matched to `_mats_skip free=`). Build
// visits fell ~150 -> ~60 per 3 h; 29 of 31 keeper terms released `no_work_visit` (the keeper's order puts the forest first, which
// is not a light plot, and its room refusal skipped the tidy behind it). The bags (~30 slots) were not cobble: cobble 3.4 slots,
// tools 7.1, building blocks + stations 4.5, earth 4.1, wood 3.9, plants 3.5, other 2.5 (mean per refusal). The town deposit
// banks only its standing targets and wants: on a real 29-slot bag it planned ONE step (cobblestone:20), refused at the town's
// cobble cap. The town's 27 containers held 196 of 729 slots (0 full; the storehub hall mostly empty). Two correct guards (the
// build's room rule, the deposit's "standing targets only") composed into a dead end: a full bag at town with an empty hall.
//
// THE REMEDY, executable where the refusal is made (at town): the room refusal orders a ROOM-BANK visit (build_shop { roomBank })
// when the town deposit's room plan (towndeposit.mjs townDepositPlan `room`) would free at least one slot: every whole stack the
// bot's kit does not need goes into the town's containers (the sorted homes first: sortstore), then the visit builds if the bag
// now has the room. THE KIT never moves: tools, cobble (its own cap / yard / well rules), stations, torches and bone meal (the
// allowance rows), junk, saplings and compost (the well's and the composter's), the iron ladder and the standing targets (the
// base plan's), withdraw holds, drawn shares (the share bank's), food, armour, and roomKitKeep below. Targeted names (wood, sand,
// dirt, gravel ...) go only under the town's stock claim (skills.mjs bankInto), so a town at its target refuses them as today.
// BAGROOM_BANK=off is the rollback (the share ask and the skip, as before).

/** One room-bank ask per bot at most this often (a bank that freed too little is not retried at once). */
export const ROOM_BANK_EVERY_MS = 10 * 60_000
/** THE ROOM KIT: what a bag keeps of a name the room bank could move (a whole stack is moved only while this much stays). */
export const ROOM_KIT_KEEP = Object.freeze({ ladder: 64, scaffolding: 64, wheat_seeds: 64, beetroot_seeds: 64, sugar_cane: 64 })
const FOOD_RE = /^(bread|apple|golden_apple|enchanted_golden_apple|baked_potato|potato|carrot|golden_carrot|beetroot|melon_slice|sweet_berries|glow_berries|cookie|pumpkin_pie|dried_kelp|honey_bottle|cod|salmon|tropical_fish|pufferfish|beef|porkchop|chicken|mutton|rabbit|(cooked|rotten)_\w+|\w+_stew|\w+_soup)$/
const ARMOUR_RE = /_(helmet|chestplate|leggings|boots)$|^(shield|elytra|totem_of_undying|compass|clock|map|filled_map|spyglass|name_tag|lead|saddle)$/
/** Is `name` part of the kit whatever the counts (never a room step)? Pure. */
const TOOLISH_RE = /_(pickaxe|axe|shovel|sword|hoe)$|^(shears|flint_and_steel|fishing_rod|bow|crossbow|trident|brush|carrot_on_a_stick)$/
export const roomKitAlways = name => typeof name !== 'string' || TOOLISH_RE.test(name) || FOOD_RE.test(name) || ARMOUR_RE.test(name) || /bucket$/.test(name)

/**
 * THE ROOM BANK'S STEPS -> [{ slot, name, count }]: whole stacks, smallest first per name, of every name the room may move, while
 * what stays of the name is >= its keep. Pure over mineflayer Items ({ name, count, slot }).
 *   eligible(name)  the caller's layer rules (towndeposit.mjs: not a tool, cobble, a row's, junk, the base plan's, held, a share)
 *   keep            { name: n } the town deposit's keeps (townKeeps); ROOM_KIT_KEEP adds to them
 *   taken           slots another step of the same plan already moves (never planned twice)
 */
export function roomBankSteps (items = [], { eligible = () => false, keep = {}, taken = new Set() } = {}) {
  const list = (Array.isArray(items) ? items : []).filter(it => it?.name && (Number(it.count) || 0) > 0 && Number.isInteger(it.slot))
  const by = new Map()
  for (const it of list) { if (!by.has(it.name)) by.set(it.name, []); by.get(it.name).push(it) }
  const out = []
  for (const [name, copies] of [...by.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (roomKitAlways(name)) continue
    let ok = false
    try { ok = !!eligible(name) } catch { ok = false }
    if (!ok) continue
    const total = copies.reduce((t, it) => t + (Number(it.count) || 0), 0)
    const k = Math.max(Number(keep?.[name]) || 0, ROOM_KIT_KEEP[name] ?? 0)
    let room = total - k
    for (const it of [...copies].sort((a, b) => (a.count - b.count) || a.slot - b.slot)) {
      if (taken.has(it.slot)) { room -= it.count; continue }
      if (it.count > room) continue
      out.push({ slot: it.slot, name, count: it.count }); room -= it.count
    }
  }
  return out
}

/**
 * MAY THE ROOM REFUSAL ORDER A ROOM BANK NOW? -> { ok, why, slots }. Pure. `slots` the whole stacks the room plan moves (each frees
 * one bag slot). ok only when switched on, the bag is short of the build's room (`need` free slots: 8, or 2 for a light plot), the
 * last ask is ROOM_BANK_EVERY_MS old, and the plan frees at least one slot.
 */
export function roomBankAsk ({ on = BAGROOM.bank, freeSlots = 36, need = BUILD_ROOM_SLOTS, slots = 0, now = 0, lastAt = null, every = ROOM_BANK_EVERY_MS } = {}) {
  if (!on) return { ok: false, why: 'off', slots: 0 }
  if (!(Number(freeSlots) < Number(need))) return { ok: false, why: 'room_ok', slots: 0 }
  if (Number.isFinite(lastAt) && lastAt + every > now) return { ok: false, why: 'recent', slots: 0 }
  if (!(Number(slots) >= 1)) return { ok: false, why: 'nothing_bankable', slots: 0 }
  return { ok: true, why: 'bank', slots: Number(slots) }
}

/** `_room_bank` row detail. Pure. */
export function roomBankDetail ({ plot = '-', need = BUILD_ROOM_SLOTS, planned = 0, slotsBefore = '-', slotsAfter = '-', banked = {}, status = '-', then = '-' } = {}) {
  const m = Object.entries(banked ?? {}).filter(([, v]) => v > 0).map(([k, v]) => `${k}:${v}`).join(',') || '-'
  return `plot=${plot} need=${need} planned=${planned} slots=${slotsBefore}->${slotsAfter} deposit=${status} then=${then} banked=${m}`.slice(0, 300)
}
