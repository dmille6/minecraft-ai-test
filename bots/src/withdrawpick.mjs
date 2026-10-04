// TAKING THINGS OUT OF THE TOWN CHESTS: a pickaxe first, else what one stone pickaxe needs.
//
// FACTS (09-27, slot by slot over RCON): the town chests hold 124,894 items -- 16,383 oak_log, 6,859 sticks, 3,782
// planks, 865 stone_pickaxe, 52,957 cobblestone -- while 45 of 80 bots carry no usable pickaxe and the pickaxe rung is
// blocked "no ingredients" ~276 times an hour. Withdraw moved 48 items a day: it was the model's verb alone (3 of 44
// tries succeeded), took the MOST PLENTIFUL item when none was named (cobblestone), and took the first copy by slot from
// a bank that is where worn tools go.
//
// THE DESIGN (Claude and Codex, agreed): a deterministic `withdraw_pick` town order, only when the bot is already at
// town, never a trip; exact quantities; room made only by banking whole stacks deposit would bank anyway; every transfer
// verified against the SERVER's bag. Pure here; skills.mjs walks, opens and clicks.

import { FLOOR, remaining, tier } from './toolfor.mjs'
import { depositPlan, DEPOSIT_VALUE } from './bankable.mjs'
import { depositFreesSlot } from './craftroom.mjs'

/** Uses left at which a trip is worth it -- oretunnel.mjs MIN_TRIP_USES, restated because importing oretunnel here is
 *  an import cycle (oretunnel -> ... -> composter -> this); withdraw-pick.test.mjs asserts the two are equal. */
export const PREFER_USES = 40
export const PICK_RE = /_pickaxe$/
const TOOL = /_(pickaxe|axe|shovel|hoe|sword)$/
export const BAG_SLOTS = 36

/** A tool is USABLE above toolfor's FLOOR (10 uses): at or under it the bot keeps it for blocks that need its tier. */
export const usableTool = it => !!it?.name && remaining(it) > FLOOR
/** Does the bag hold a pickaxe the bot can dig with? */
export const hasUsablePick = (items = []) => (Array.isArray(items) ? items : []).some(it => PICK_RE.test(it?.name ?? '') && usableTool(it))

/**
 * THE COPY TO TAKE -> the item | null. Pure. Never a spent copy (remaining <= FLOOR). Preferred: a copy with at least
 * PREFER_USES uses (a trip's worth); then the best tier (iron > stone > wooden; toolfor.mjs tier); then the most uses
 * left; then the lowest slot. Unknown durability counts as full (toolfor.mjs remaining), the direction toolfor chose.
 */
export function bestToolCopy (copies = []) {
  const ok = (Array.isArray(copies) ? copies : []).filter(c => c?.name && usableTool(c))
  const key = c => [remaining(c) >= PREFER_USES ? 1 : 0, tier(c.name), Math.min(remaining(c), 1e9), -(c.slot ?? 0)]
  ok.sort((a, b) => { const ka = key(a), kb = key(b); for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return kb[i] - ka[i]; return 0 })
  return ok[0] ?? null
}

/** The stone-pickaxe ingredients, by what the recipe accepts (1.21 stone_tool_materials; any planks). */
export const NEEDS = Object.freeze({
  cobblestone: { label: 'cobblestone', match: n => /^(cobblestone|cobbled_deepslate|blackstone)$/.test(n), prefer: ['cobblestone', 'cobbled_deepslate', 'blackstone'] },
  stick: { label: 'stick', match: n => n === 'stick', prefer: ['stick'] },
  planks: { label: 'planks', match: n => /_planks$/.test(n), prefer: [] },
})
const held = (items, match) => (Array.isArray(items) ? items : []).reduce((n, it) => n + (it?.name && match(it.name) ? (it.count ?? 0) : 0), 0)

/**
 * WHAT ONE STONE PICKAXE STILL NEEDS -> [{ need, count }] (exact). Pure. 3 cobblestone (or its variants) and 2 sticks,
 * minus what is held; 4 planks for the crafting table only when none is carried and none is within STATION_REACH
 * (`tableNear`) -- planks held, and logs at 4 planks each, count toward them. With these in the bag craftReady turns true
 * and the existing rung work order makes the pickaxe.
 */
export function stonePickDeficits (items = [], { tableNear = false } = {}) {
  const out = []
  const cobble = held(items, NEEDS.cobblestone.match)
  if (cobble < 3) out.push({ need: 'cobblestone', count: 3 - cobble })
  const sticks = held(items, NEEDS.stick.match)
  if (sticks < 2) out.push({ need: 'stick', count: 2 - sticks })
  const tableCarried = held(items, n => n === 'crafting_table') > 0
  if (!tableCarried && !tableNear) {
    const planks = held(items, NEEDS.planks.match) + 4 * held(items, n => /_(log|stem)$/.test(n))
    if (planks < 4) out.push({ need: 'planks', count: 4 - planks })
  }
  return out
}

/** Everything one stone pickaxe is made from -- kept by every room-making deposit on both paths (both reviews). */
export const INGREDIENT_KEEP = Object.freeze([NEEDS.cobblestone.match, NEEDS.stick.match, NEEDS.planks.match,
                                              n => /_(log|stem)$/.test(n), n => n === 'crafting_table'])
/** The keep list for a room plan: what the bot's current goal wants, and the ingredient families. Same at order time
 *  (townOrder's pickRoom) and at the chest. */
export const roomKeep = (wants = []) => [...(Array.isArray(wants) ? wants : []), ...INGREDIENT_KEEP]
const kept = (keep, name) => (keep ?? []).some(k => (typeof k === 'function' ? k(name) : k === name))
const stackOf = it => (TOOL.test(it?.name ?? '') || it?.maxDurability ? 1 : (it?.stackSize ?? 64))

/**
 * WHERE n OF AN ITEM GO -> { partial: [{ slot, n }], fresh, leftover }. Pure. THE ONE STACKING RULE, used by the room
 * plan AND the transfer (Codex: they disagreed -- two 63-stick stacks passed the plan for 2 sticks and the transfer,
 * which wanted one stack with room for both, moved nothing). Partial stacks of the item first, each up to its stack
 * size (slot order, as vanilla fills them), then `emptySlots` fresh stacks; what still does not fit is the leftover.
 */
export function allocate (items = [], name, n, { emptySlots = 0, stackSize = 64 } = {}) {
  let left = Math.max(0, n)
  const partial = []
  if (!(TOOL.test(name))) {
    for (const it of (Array.isArray(items) ? items : []).filter(x => x?.name === name).sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0))) {
      if (left <= 0) break
      const room = Math.max(0, stackOf(it) - (it.count ?? 0))
      if (room > 0) { const k = Math.min(room, left); partial.push({ slot: it.slot, n: k }); left -= k }
    }
  }
  const per = TOOL.test(name) ? 1 : stackSize
  const fresh = Math.min(emptySlots, Math.ceil(left / per))
  left = Math.max(0, left - fresh * per)
  return { partial, fresh, leftover: left }
}

/** HOW MANY NEW SLOTS a set of takes needs -> number. Pure: allocate's own count of fresh stacks, with room to spare. */
export function slotsNeeded (items = [], takes = []) {
  let n = 0
  for (const t of takes) {
    if (t.tool) { n++; continue }
    n += allocate(items, t.name, t.count, { emptySlots: Infinity }).fresh
  }
  return n
}

/**
 * THE STACKS A DEPOSIT MAY MOVE TO MAKE ROOM -> [{ name, count, slot }], CHEAPEST FIRST. Pure. Only what deposit
 * itself would bank (depositPlan's allowance -- scaffold reserve, usable-tool copies, stations, junk and holds all stay),
 * only stacks that leave WHOLE (craftroom.mjs depositFreesSlot), never a tool, never anything in `keep` (the goal's
 * wants and the stone-pickaxe ingredients). Cheapest first by DEPOSIT_VALUE, from its cheap end (Codex reproduced the
 * old order banking 3 iron ingots the next craft needed); anything deposit banks that is not in that list goes last.
 */
export function roomCandidates (items = [], { keep = [] } = {}) {
  const list = (Array.isArray(items) ? items : []).filter(it => it?.name)
  const rank = name => { const i = DEPOSIT_VALUE.indexOf(name); return i < 0 ? -1 : i }   // higher = cheaper
  const plan = depositPlan(list).filter(e => !TOOL.test(e.name) && !kept(keep, e.name)).sort((a, b) => rank(b.name) - rank(a.name))
  const out = []
  for (const e of plan) {
    let allow = e.count
    for (const it of list.filter(x => x.name === e.name).sort((a, b) => (a.count ?? 0) - (b.count ?? 0) || (a.slot ?? 0) - (b.slot ?? 0))) {
      if ((it.count ?? 0) > allow || !depositFreesSlot([it], [{ name: e.name, count: it.count }])) continue
      out.push({ name: it.name, count: it.count, slot: it.slot })
      allow -= it.count
    }
  }
  return out
}

/**
 * ROOM, EXACTLY -> { ok, need, empty, deposit: [{ name, count, slot }] }. Pure. room = empty slots + partial-stack
 * merges (allocate). Short of empty slots, the difference is made from roomCandidates, cheapest first; ok = false:
 * nothing can be freed here -- no order. `keep` must be roomKeep(wants) at order time and at the chest alike.
 */
export function roomPlan (items = [], takes = [], { keep = [] } = {}) {
  const list = (Array.isArray(items) ? items : []).filter(it => it?.name)
  const need = slotsNeeded(list, takes)
  const empty = Math.max(0, BAG_SLOTS - list.length)
  if (empty >= need) return { ok: true, need, empty, deposit: [] }
  const takeNames = takes.filter(t => t.name && !t.tool).map(t => t.name)
  const short = need - empty
  const deposit = roomCandidates(list, { keep: [...keep, ...takeNames] }).slice(0, short)
  return { ok: deposit.length >= short, need, empty, deposit: deposit.length >= short ? deposit : [] }
}

/** What the order is for at issue time: one pickaxe slot (the ingredients path is re-planned at the chest). */
export const pickTakes = () => [{ tool: true, name: 'pickaxe' }]

/**
 * IS THE BAG'S CHANGE EXACTLY WHAT WAS DONE? -> { ok, why }. Pure over two bags (the server's, before and after).
 *   took  { name: n }  must have risen by exactly n
 *   gave  { name: n }  must have fallen by exactly n
 *   tool  { name, used } the copies of that name must have GAINED exactly one, with that wear (Codex: counting copies
 *                         accepted a spent replacement -- before [30], after [30, 129], expected 30)
 * Anything else changed by a transfer is not judged here (the auto-pickup of an item on the ground can land at any time).
 */
export function transferVerdict ({ before = [], after = [], took = {}, gave = {}, tool = null } = {}) {
  const count = (list, name) => (Array.isArray(list) ? list : []).reduce((n, it) => n + (it?.name === name ? (it.count ?? 0) : 0), 0)
  for (const [name, n] of Object.entries(took)) {
    if (tool && name === tool.name) continue
    const d = count(after, name) - count(before, name)
    if (d !== n) return { ok: false, why: `${name} changed by ${d}, expected +${n}` }
  }
  for (const [name, n] of Object.entries(gave)) {
    const d = count(before, name) - count(after, name)
    if (d !== n) return { ok: false, why: `${name} fell by ${d}, expected ${n}` }
  }
  if (tool) {
    const wear = list => { const m = new Map(); for (const it of (Array.isArray(list) ? list : [])) if (it?.name === tool.name) m.set(it.durabilityUsed ?? 0, (m.get(it.durabilityUsed ?? 0) ?? 0) + (it.count ?? 1)); return m }
    const b = wear(before), a = wear(after)
    const gained = [], lost = []
    for (const k of new Set([...a.keys(), ...b.keys()])) {
      const d = (a.get(k) ?? 0) - (b.get(k) ?? 0)
      for (let i = 0; i < d; i++) gained.push(k)
      for (let i = 0; i < -d; i++) lost.push(k)
    }
    if (gained.length !== 1 || lost.length || gained[0] !== (tool.used ?? 0)) {
      return { ok: false, why: `${tool.name} copies gained [${gained.join(',')}]${lost.length ? ` lost [${lost.join(',')}]` : ''}, expected [${tool.used ?? 0}]` }
    }
  }
  return { ok: true, why: null }
}

/** The server-recounted change, for the row: srv=stick:+2,stone_pickaxe:+1 (names whose totals moved). */
export function bagDelta (before = [], after = []) {
  const tot = list => { const m = {}; for (const it of (Array.isArray(list) ? list : [])) if (it?.name) m[it.name] = (m[it.name] ?? 0) + (it.count ?? 0); return m }
  const b = tot(before), a = tot(after)
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].map(k => [k, (a[k] ?? 0) - (b[k] ?? 0)]).filter(([, d]) => d)
    .map(([k, d]) => `${k}:${d > 0 ? '+' : ''}${d}`).join(',') || '-'
}

/** Per-bot cooldown and backoff of the order (townOrder state), and the town-wide miss memory's lifetime. */
export const WITHDRAW_COOLDOWN_MS = 5 * 60 * 1000
export const WITHDRAW_BACKOFF_MS = 15 * 60 * 1000
/** Failures that moved nothing and say nothing about the town: no backoff beyond the cooldown. */
export const WITHDRAW_NO_BACKOFF = new Set(['recount_unanswered', 'chest_no_room'])
/** How long what was withdrawn is held back from deposit (bankable.mjs setWithdrawHold). */
export const HOLD_MS = 10 * 60 * 1000

/** The withdraw row (`_withdraw_pick`, from the order AND the model's verb): key=value, outcome first, the containers
 *  last (logEvent cuts at 300 characters). srv= is the server-recounted change of the bag. */
export function withdrawRow ({ outcome, need, uses = null, verification = 'none', cursor = '-', err = null, chestRoom = null, srv = '-',
                               bagBefore = 0, bagAfter = 0, deposited = [], took = {}, verb = 'withdraw_pick', tried = [] } = {}) {
  const dep = deposited.map(d => `${d.name}:${d.count}`).join(',') || '-'
  const tk = Object.entries(took).map(([k, v]) => `${k}:${v}`).join(',') || '-'
  const clean = v => String(v ?? '-').replace(/\s+/g, '_').slice(0, 40)
  return (`outcome=${outcome} need=${need} uses=${uses ?? '-'} verification=${verification} cursor=${clean(cursor)} err=${clean(err)} ` +
          `chest_room=${chestRoom ?? '-'} srv=${srv} bag=${bagBefore}->${bagAfter} deposited=${dep} took=${tk} verb=${verb} ` +
          `tried=[${tried.join(';')}]`).slice(0, 300)
}
