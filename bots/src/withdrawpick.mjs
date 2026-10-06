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

import { FLOOR, remaining, tier, TOOL_TIER } from './toolfor.mjs'
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
 * THE COPY TO TAKE -> the item | null. Pure. BEST-FIRST (withdraw2, owner 10-06): never a spent copy (remaining <=
 * FLOOR); then the best TIER (toolfor TOOL_TIER: netherite > diamond > iron > stone > golden > wooden); then the most
 * uses left; then the lowest slot. Unknown durability counts as full (toolfor.mjs remaining), the direction toolfor
 * chose. (withdraw-01 ranked ">= PREFER_USES uses" above tier, so a fresh wooden beat a worn iron: 7 of 13 taken live
 * were WOODEN.)
 */
const copyKey = c => [tier(c.name), Math.min(remaining(c), 1e9), -(c.slot ?? 0)]
const byKey = (a, b) => { const ka = copyKey(a), kb = copyKey(b); for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return kb[i] - ka[i]; return 0 }
export function bestToolCopy (copies = []) {
  const ok = (Array.isArray(copies) ? copies : []).filter(c => c?.name && usableTool(c))
  ok.sort(byKey)
  return ok[0] ?? null
}
/** Every usable copy, best first (the same key), across containers: [{ ...copy, at: containerKey }]. Ties: container
 *  key, for a deterministic order. Pure. */
export function rankCopies (copies = []) {
  const ok = (Array.isArray(copies) ? copies : []).filter(c => c?.name && usableTool(c))
  return ok.sort((a, b) => byKey(a, b) || String(a.at ?? '').localeCompare(String(b.at ?? '')))
}

// ---- tiers (withdraw2) ------------------------------------------------------------------------------------------
export const TIER_IRON = TOOL_TIER.indexOf('iron')
export const tierName = t => (t >= 0 && t < TOOL_TIER.length ? TOOL_TIER[t] : 'none')
/** A copy's tier when it is a USABLE pickaxe, else -1. */
export const pickTier = it => (it?.name && PICK_RE.test(it.name) && usableTool(it) ? tier(it.name) : -1)
/** The bag's best usable pickaxe tier (-1: none). */
export const heldPickTier = (items = []) => (Array.isArray(items) ? items : []).reduce((b, it) => Math.max(b, pickTier(it)), -1)

// ---- negative evidence for the upgrade trigger (withdraw2) --------------------------------------------------------
/**
 * "At `at`, nothing in this container was a better usable pickaxe than `tier`" (-1: no usable pickaxe at all), per
 * container, in chest2's town memory: { 'x,y,z': { at, tier } }. NEGATIVE only: anyone's withdrawal can only lower the
 * true best, so it stays valid; an insertion is covered by deposit's 'took' entry (a later one invalidates). No
 * positive census is kept (stale under other bots' withdrawals and trades -- Codex design check).
 */
export const PICK_BEST_KEY = '_pick_best'
export const PICK_BEST_TTL_MS = 15 * 60 * 1000
export function notePickBest (entries, keys = [], t = -1, now = Date.now()) {
  const m = { ...(entries[PICK_BEST_KEY] ?? {}) }
  for (const k of keys) m[k] = { at: now, tier: t }
  for (const [k, v] of Object.entries(m)) if (!(now - v?.at < PICK_BEST_TTL_MS)) delete m[k]
  entries[PICK_BEST_KEY] = m
}
const freshAfterTook = (entries, k, at) => { const e = entries?.[k]; return !(e?.o === 'took' && e.at > at) }
export function containerPickBestAtMost (entries = {}, k, t, now = Date.now()) {
  const v = entries?.[PICK_BEST_KEY]?.[k]
  if (!v || !Number.isFinite(v.at) || now - v.at >= PICK_BEST_TTL_MS || !(v.tier <= t)) return false
  return freshAfterTook(entries, k, v.at)
}
/** A better copy than `held` is ruled out only with COMPLETE coverage of the town's containers. */
export const townBetterPickRuledOut = (entries = {}, keys = [], held = -1, now = Date.now()) =>
  keys.length > 0 && keys.every(k => containerPickBestAtMost(entries, k, held, now))

/**
 * HOW MANY IRON INGOTS a container held when last looked in, with QUANTITY (Codex: 2 + 1 across two chests is not
 * "none"): { 'x,y,z': { at, count } }. A double chest's count goes on its first key, 0 on the other half, so a sum over
 * keys counts it once. Ruled out only with complete coverage, every entry fresh, and the sum below the deficit.
 */
export const INGOT_SEEN_KEY = '_ingot_seen'
export const INGOT_SEEN_TTL_MS = 15 * 60 * 1000
export function noteIngotsSeen (entries, keys = [], count = 0, now = Date.now()) {
  const m = { ...(entries[INGOT_SEEN_KEY] ?? {}) }
  keys.forEach((k, i) => { m[k] = { at: now, count: i === 0 ? Math.max(0, count) : 0 } })
  for (const [k, v] of Object.entries(m)) if (!(now - v?.at < INGOT_SEEN_TTL_MS)) delete m[k]
  entries[INGOT_SEEN_KEY] = m
}
/** Freshly known to hold no iron ingots at all (and nothing deposited since)? */
export function containerIngotsNone (entries = {}, k, now = Date.now()) {
  const v = entries?.[INGOT_SEEN_KEY]?.[k]
  return !!v && Number.isFinite(v.at) && now - v.at < INGOT_SEEN_TTL_MS && (v.count ?? 0) === 0 && freshAfterTook(entries, k, v.at)
}
export function townIngotsRuledOut (entries = {}, keys = [], need = 1, now = Date.now()) {
  if (!(need > 0)) return false
  if (!keys.length) return false
  let sum = 0
  for (const k of keys) {
    const v = entries?.[INGOT_SEEN_KEY]?.[k]
    if (!v || !Number.isFinite(v.at) || now - v.at >= INGOT_SEEN_TTL_MS || !freshAfterTook(entries, k, v.at)) return false
    sum += v.count ?? 0
  }
  return sum < need
}

// ---- the iron pickaxe plan (withdraw2) ----------------------------------------------------------------------------
/** The iron path at most once per bot per this long (charged BEFORE its first mutation, kept through failure, abort and
 *  an unverified outcome), plus a per-bot stagger so a town's bots do not retry together (Codex design check). */
export const IRON_ATTEMPT_COOLDOWN_MS = 30 * 60 * 1000
export const ironStagger = (name = '') => { let h = 0; for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % (5 * 60 * 1000) }
/** The iron path starts only with at least this much of the order's clock left (two take visits and a craft). */
export const IRON_MIN_MS = 60_000
/** One iron pickaxe: 3 iron_ingot + 2 sticks, at a crafting table. */
export const IRON_PICK = Object.freeze({ ingots: 3, sticks: 2, tablePlanks: 4, sticksPlanks: 2 })
const isLog = n => /_(log|stem)$/.test(n)
/** What one iron pickaxe still needs beyond the bag (exact). Pure. Planks for sticks only when sticks are short; planks
 *  for a table only when none is carried or within reach. Held planks, and logs at 4 planks each, count. */
export function ironDeficits (items = [], { tableNear = false } = {}) {
  const ingots = Math.max(0, IRON_PICK.ingots - held(items, n => n === 'iron_ingot'))
  const sticks = Math.max(0, IRON_PICK.sticks - held(items, NEEDS.stick.match))
  const tableCarried = held(items, n => n === 'crafting_table') > 0
  const tablePlanks = !tableCarried && !tableNear ? IRON_PICK.tablePlanks : 0
  const woodHeld = held(items, NEEDS.planks.match) + 4 * held(items, isLog)
  return { ingots, sticks, tablePlanks, woodHeld }
}
const most = (saw, match) => {
  const by = {}
  for (const it of saw) if (it?.name && match(it.name)) by[it.name] = (by[it.name] ?? 0) + (it.count ?? 0)
  return Object.entries(by).sort((a, b) => b[1] - a[1])[0] ?? null
}
/** The prerequisites (sticks or their wood, table planks) from ONE container's contents -> takes | null. */
function prereqTakes (d, saw) {
  const takes = []
  let planks = d.tablePlanks
  if (d.sticks > 0) {
    const st = saw.reduce((n, it) => n + (it?.name === 'stick' ? (it.count ?? 0) : 0), 0)
    if (st >= d.sticks) takes.push({ name: 'stick', count: d.sticks })
    else planks += IRON_PICK.sticksPlanks
  }
  planks = Math.max(0, planks - d.woodHeld)
  if (planks > 0) {
    const pl = most(saw, NEEDS.planks.match)
    if (pl && pl[1] >= planks) takes.push({ name: pl[0], count: planks })
    else {
      const lg = most(saw, isLog)
      const logs = Math.ceil(planks / 4)
      if (lg && lg[1] >= logs) takes.push({ name: lg[0], count: logs })
      else return null
    }
  }
  return takes
}
/**
 * THE IRON PLAN -> { ok, why, steps: [{ key, takes }] }. Pure. From the inspected containers' contents (`survey`:
 * [{ key, saw }], in visit order) and the bag: an executable sequence of AT MOST TWO take visits -- the ingot deficit
 * from ONE container, every prerequisite from that same container or from ONE other, which comes FIRST (ingots are
 * taken last: never ingots the bot cannot use at once). No plan -> ok false, nothing is taken.
 */
export function ironPlan (items = [], survey = [], { tableNear = false } = {}) {
  const d = ironDeficits(items, { tableNear })
  const ingotsIn = c => (c.saw ?? []).reduce((n, it) => n + (it?.name === 'iron_ingot' ? (it.count ?? 0) : 0), 0)
  const none = prereqTakes(d, [])
  if (d.ingots === 0) {
    if (none && !none.length) return { ok: true, why: null, steps: [] }
    for (const c of survey) { const pre = prereqTakes(d, c.saw ?? []); if (pre) return { ok: true, why: null, steps: [{ key: c.key, takes: pre }] } }
    return { ok: false, why: 'no container holds the sticks or wood', steps: [] }
  }
  for (const I of survey.filter(c => ingotsIn(c) >= d.ingots)) {
    const ing = { name: 'iron_ingot', count: d.ingots }
    const here = prereqTakes(d, I.saw ?? [])
    if (here) return { ok: true, why: null, steps: [{ key: I.key, takes: [...here, ing] }] }
    for (const P of survey) {
      if (P.key === I.key) continue
      const pre = prereqTakes(d, P.saw ?? [])
      if (pre) return { ok: true, why: null, steps: [{ key: P.key, takes: pre }, { key: I.key, takes: [ing] }] }
    }
  }
  return { ok: false, why: survey.some(c => ingotsIn(c) >= d.ingots) ? 'no container holds the sticks or wood' : `no container holds ${d.ingots} iron ingots`, steps: [] }
}

/** The stone-pickaxe ingredients, by what the recipe accepts (1.21 stone_tool_materials; any planks). */
export const NEEDS = Object.freeze({
  cobblestone: { label: 'cobblestone', match: n => /^(cobblestone|cobbled_deepslate|blackstone)$/.test(n), prefer: ['cobblestone', 'cobbled_deepslate', 'blackstone'] },
  stick: { label: 'stick', match: n => n === 'stick', prefer: ['stick'] },
  planks: { label: 'planks', match: n => /_planks$/.test(n), prefer: [] },
  // withdraw2: logs as their own need (the iron path makes sticks and a table from them), so a container's evidence can
  // say "no wood at all" -- never one of stonePickDeficits' needs.
  log: { label: 'log', match: n => /_(log|stem)$/.test(n), prefer: [] },
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
 * THE INGREDIENT BRANCH'S OWN NEGATIVE EVIDENCE (withdraw-habit review: a town with no pickaxe is exactly when the
 * ingredients matter, and the whole order used to be blocked by the pickaxe misses). Per container and per NEED
 * (cobblestone / stick / planks): "held none of it", seen at `at`, valid INGREDIENT_MISS_TTL_MS -- unless the container
 * has TAKEN items since (a deposit may have brought some), the same rule as a pickaxe miss. Kept in the town's memory
 * under a key no container can have: { 'x,y,z': { need: at } }.
 */
export const INGREDIENT_MISS_KEY = '_ingredient_miss'
export const INGREDIENT_MISS_TTL_MS = 15 * 60 * 1000
/** The needs a container's contents (`saw`, [{ name, count }]) held NONE of. */
export const ingredientNeedsAbsent = (saw = []) => Object.keys(NEEDS).filter(n => held(saw, NEEDS[n].match) === 0)
export function containerIngredientMiss (entries = {}, k, need, now = Date.now()) {
  const at = entries?.[INGREDIENT_MISS_KEY]?.[k]?.[need]
  if (!Number.isFinite(at) || now - at >= INGREDIENT_MISS_TTL_MS) return false
  const e = entries?.[k]
  return !(e?.o === 'took' && e.at > at)
}
/** Record what these containers (both halves of a double chest) were seen to hold none of; expired entries pruned. */
export function noteIngredientMisses (entries, keys = [], needs = [], now = Date.now()) {
  const m = {}
  for (const [k, v] of Object.entries(entries[INGREDIENT_MISS_KEY] ?? {})) m[k] = { ...v }
  for (const k of keys) { m[k] ??= {}; for (const n of needs) m[k][n] = now }
  for (const [k, v] of Object.entries(m)) {
    for (const [n, at] of Object.entries(v)) if (!(now - at < INGREDIENT_MISS_TTL_MS)) delete v[n]
    if (!Object.keys(v).length) delete m[k]
  }
  entries[INGREDIENT_MISS_KEY] = m
}
/**
 * IS THE INGREDIENT BRANCH FUTILE HERE? -> true when nothing is needed (`needs` empty), or when EVERY container listed
 * (complete coverage) recently held none of EVERY need -- one container with one need not ruled out is worth the trip.
 */
export const townIngredientMissComplete = (entries = {}, keys = [], needs = [], now = Date.now()) =>
  needs.length === 0 || (keys.length > 0 && keys.every(k => needs.every(n => containerIngredientMiss(entries, k, n, now))))

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

/**
 * MUST A HELD CURSOR BE RELEASED FOR SURVIVAL? -> 'reflex:<name>' | null. Pure (Claude, round 3). A cursor held over a
 * chest (skills.mjs holdUnsettled) is never worth a death: air (the head in water or inside a block), lava or fire at the
 * feet, burning, falling, or damage taken since the last tick (or health at the flee line) release it -- one last settle,
 * then the close. Hunger is not here: eating needs an equip, which the hold refuses, and hunger is never this urgent.
 */
const HOT = /^(lava|flowing_lava|fire|soul_fire|campfire|soul_campfire|magma_block)$/
export function survivalRelease ({ head = null, feet = null, below = null, onFire = false, velocityY = 0, onGround = true,
                                   health = 20, lastHealth = null, fleeBelow = 8 } = {}) {
  if (head && (/water/.test(head.name ?? '') || head.boundingBox === 'block')) return 'reflex:air'
  if (HOT.test(feet?.name ?? '') || HOT.test(below?.name ?? '')) return /lava/.test(`${feet?.name} ${below?.name}`) ? 'reflex:lava' : 'reflex:fire'
  if (onFire) return 'reflex:fire'
  if (!onGround && velocityY < -0.6) return 'reflex:fall'
  if ((lastHealth != null && health < lastHealth) || health <= fleeBelow) return 'reflex:damage'
  return null
}

/** Per-bot cooldown and backoff of the order (townOrder state), and the town-wide miss memory's lifetime. */
export const WITHDRAW_COOLDOWN_MS = 5 * 60 * 1000
export const WITHDRAW_BACKOFF_MS = 15 * 60 * 1000
/** An UPGRADE order (a usable pickaxe below iron is held) at most once per bot per this long (withdraw2). */
export const UPGRADE_COOLDOWN_MS = 30 * 60 * 1000
/** Failures that moved nothing and say nothing about the town: no backoff beyond the cooldown. */
export const WITHDRAW_NO_BACKOFF = new Set(['recount_unanswered', 'chest_no_room'])
/** How long what was withdrawn is held back from deposit (bankable.mjs setWithdrawHold). */
export const HOLD_MS = 10 * 60 * 1000

/** The withdraw row (`_withdraw_pick`, from the order AND the model's verb): key=value, outcome first, the containers
 *  last (logEvent cuts at 300 characters). srv= is the server-recounted change of the bag; plan= the names planned to
 *  LEAVE it (room-making deposits and trades) -- a read can flag a server-counted fall of any name not in plan=. */
export function withdrawRow ({ outcome, need, uses = null, verification = 'none', cursor = '-', err = null, chestRoom = null, srv = '-', plan = '-',
                               bagBefore = 0, bagAfter = 0, deposited = [], took = {}, verb = 'withdraw_pick', tried = [],
                               held = null, tookTier = null, bestValid = null, craft = null } = {}) {
  const dep = deposited.map(d => `${d.name}:${d.count}`).join(',') || '-'
  const tk = Object.entries(took).map(([k, v]) => `${k}:${v}`).join(',') || '-'
  const clean = v => String(v ?? '-').replace(/\s+/g, '_').slice(0, 40)
  return (`outcome=${outcome} need=${need} uses=${uses ?? '-'} verification=${verification} cursor=${clean(cursor)} err=${clean(err)} ` +
          `chest_room=${chestRoom ?? '-'} plan=${plan || '-'} srv=${srv} bag=${bagBefore}->${bagAfter} deposited=${dep} took=${tk} ` +
          (held != null ? `held=${held} took_tier=${tookTier ?? '-'} best_valid=${bestValid ?? '-'} craft=${craft ?? '-'} ` : '') + `verb=${verb} ` +
          `tried=[${tried.join(';')}]`).slice(0, 300)
}
