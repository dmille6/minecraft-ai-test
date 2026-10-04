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
import { depositPlan } from './bankable.mjs'
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

/**
 * HOW MANY NEW SLOTS a set of takes needs -> number. Pure. A tool always needs an empty slot; an ingredient fits into a
 * partial stack of a matching item if one has room for the whole count, else it needs one slot (counts are <= 64).
 */
export function slotsNeeded (items = [], takes = []) {
  const list = (Array.isArray(items) ? items : []).filter(it => it?.name)
  let n = 0
  for (const t of takes) {
    if (t.tool) { n++; continue }
    const match = NEEDS[t.need]?.match ?? (x => x === t.name)
    const room = list.filter(it => match(it.name) && !TOOL.test(it.name)).reduce((a, it) => a + Math.max(0, (it.stackSize ?? 64) - (it.count ?? 0)), 0)
    if (room < t.count) n++
  }
  return n
}

/**
 * ROOM, EXACTLY -> { ok, need, empty, deposit: [{ name, count, slot }] }. Pure.
 * room = empty slots + partial-stack merges (slotsNeeded). When the empty slots fall short, the difference is made by
 * banking WHOLE stacks that deposit itself would bank and empty (depositPlan's own allowance -- the scaffold reserve,
 * one tool per family, stations and junk all stay -- and craftroom.mjs depositFreesSlot's rule that a stack moved whole
 * frees its slot). Never a tool (spent tools never move either way, and the kept copy is the way out of a hole), never
 * anything the takes are for (`keep`), never junk (depositPlan does not bank it). Smallest stacks first, so one plan
 * entry empties as many slots as it can. ok = false: nothing can be freed here -- issue no order.
 */
export function roomPlan (items = [], takes = [], { keep = [] } = {}) {
  const list = (Array.isArray(items) ? items : []).filter(it => it?.name)
  const need = slotsNeeded(list, takes)
  const empty = Math.max(0, BAG_SLOTS - list.length)
  if (empty >= need) return { ok: true, need, empty, deposit: [] }
  const keepMatch = n => keep.some(k => (typeof k === 'function' ? k(n) : k === n)) ||
    takes.some(t => (NEEDS[t.need]?.match ?? (x => x === t.name))(n))
  const deposit = []
  let short = need - empty
  for (const e of depositPlan(list)) {
    if (short <= 0) break
    if (TOOL.test(e.name) || keepMatch(e.name)) continue
    let allow = e.count
    const stacks = list.filter(it => it.name === e.name).sort((a, b) => (a.count ?? 0) - (b.count ?? 0) || (a.slot ?? 0) - (b.slot ?? 0))
    for (const it of stacks) {
      if (short <= 0) break
      if ((it.count ?? 0) > allow || !depositFreesSlot([it], [{ name: e.name, count: it.count }])) continue
      deposit.push({ name: it.name, count: it.count, slot: it.slot })
      allow -= it.count
      short--
    }
  }
  return { ok: short <= 0, need, empty, deposit: short <= 0 ? deposit : [] }
}

/** What the order is for -> { takes, why } for the room check at issue time: one pickaxe slot (the ingredients path is
 *  re-planned at the chest, only when no usable copy was found). */
export const pickTakes = () => [{ tool: true, name: 'pickaxe' }]

/**
 * IS THE BAG'S CHANGE EXACTLY WHAT WAS DONE? -> { ok, why }. Pure over two bags (the server's, before and after).
 *   took  { name: n }  must have risen by exactly n
 *   gave  { name: n }  must have fallen by exactly n
 *   tool  { name, used } the copy taken: one more of that name, and a copy with that wear present
 * Anything else changed by a transfer is not judged here (the auto-pickup of an item on the ground can land at any time).
 */
export function transferVerdict ({ before = [], after = [], took = {}, gave = {}, tool = null } = {}) {
  const count = (list, name) => (Array.isArray(list) ? list : []).reduce((n, it) => n + (it?.name === name ? (it.count ?? 0) : 0), 0)
  for (const [name, n] of Object.entries(took)) {
    const d = count(after, name) - count(before, name)
    if (d !== n) return { ok: false, why: `${name} changed by ${d}, expected +${n}` }
  }
  for (const [name, n] of Object.entries(gave)) {
    const d = count(before, name) - count(after, name)
    if (d !== n) return { ok: false, why: `${name} fell by ${d}, expected ${n}` }
  }
  if (tool) {
    const d = count(after, tool.name) - count(before, tool.name)
    if (d !== 1) return { ok: false, why: `${tool.name} changed by ${d}, expected +1` }
    if (!(Array.isArray(after) ? after : []).some(it => it?.name === tool.name && (it.durabilityUsed ?? 0) === (tool.used ?? 0))) {
      return { ok: false, why: `no ${tool.name} with ${tool.used} wear in the bag` }
    }
  }
  return { ok: true, why: null }
}

/** Per-bot cooldown and backoff of the order (townOrder state), and the town-wide miss memory's lifetime. */
export const WITHDRAW_COOLDOWN_MS = 5 * 60 * 1000
export const WITHDRAW_BACKOFF_MS = 15 * 60 * 1000
/** How long what was withdrawn is held back from deposit (bankable.mjs setWithdrawHold). */
export const HOLD_MS = 10 * 60 * 1000

/** The order's row (`_withdraw_pick`): key=value, outcome first, the containers last (logEvent cuts at 300 chars). */
export function withdrawRow ({ outcome, need, uses = null, verification = 'none', bagBefore = 0, bagAfter = 0, deposited = [], took = {}, tried = [] } = {}) {
  const dep = deposited.map(d => `${d.name}:${d.count}`).join(',') || '-'
  const tk = Object.entries(took).map(([k, v]) => `${k}:${v}`).join(',') || '-'
  return (`outcome=${outcome} need=${need} uses=${uses ?? '-'} verification=${verification} bag=${bagBefore}->${bagAfter} ` +
          `deposited=${dep} took=${tk} tried=[${tried.join(';')}]`).slice(0, 300)
}
