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
import { countOf, OBS_TTL_MS } from './cobblecap.mjs'
import { STOCK_GROUP_NAMES } from './stocktarget.mjs'

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
 * THE INGREDIENT BRANCH'S OWN NEGATIVE EVIDENCE (withdraw-habit review: a town with no pickaxe is exactly when the
 * ingredients matter, and the whole order used to be blocked by the pickaxe misses). Per container and per NEED
 * (cobblestone / stick / planks): "held none of it", seen at `at`, valid INGREDIENT_MISS_TTL_MS -- unless the container
 * has TAKEN items since (a deposit may have brought some), the same rule as a pickaxe miss. Kept in the town's memory
 * under a key no container can have: { 'x,y,z': { need: at } }.
 */
export const INGREDIENT_MISS_KEY = '_ingredient_miss'
/**
 * HOW LONG "LOOKED, NONE" HOLDS (townsearch-01): 60 min, for the pickaxe (chestfull.mjs PICK_MISS_TTL_MS, asserted equal)
 * and for each ingredient. It was 15 min, and the same bot's next withdraw_pick comes a median 16.2 min later (10-14..16,
 * 193 gaps, 66% >= 15 min) -- the miss had expired by then, so every order re-opened the same containers nearest home.
 * A deposit into the container since (town memory o='took') still ends a miss at once.
 */
export const SEARCH_MISS_TTL_MS = 60 * 60 * 1000
export const INGREDIENT_MISS_TTL_MS = SEARCH_MISS_TTL_MS
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

// ---- THE TOWN SEARCH (townsearch-01) -----------------------------------------------------------------------------------
// MEASURED 10-16: every town held usable pickaxes (4-16 stone with damage <= 65, in 5-12 containers) and sticks, yet
// withdraw_pick failed "none in the 6 container(s) tried here" 134 times in 10-14..16. The order looked in the 3 containers
// nearest HOME for the pickaxe and the next 3 for the ingredients, every time (the 15-min miss expired before the bot's next
// order). Until the 10-14 02:21Z chest clear that was harmless -- sticks sat in 4-6 of the nearest 6 containers of all 16
// towns; the clear left one stick stack per town, in one container, and the nearest 6 held sticks in 5 towns of 16. Over
// 426 orders in 2.5 days each town's orders opened 5-14 distinct containers of 11-32, and 0-3 of the 5-13 holding a pickaxe.
// Now the order may look in EVERY town container: those the town's stock journal last counted holding the need first, the
// unknown ones next, nearest the bot first; a container that showed none (a miss, or a count of none, within
// SEARCH_MISS_TTL_MS and with no deposit since) is not looked in again, so successive orders continue where the last stopped.

/** Visits per order: the pickaxe first, then the ingredients (each pass its own budget, so the fallback always runs).
 *  Paper 10-16 (sandbox3, a 12-chest town): 10 visits took 10.4 s, ~1 s each -- a town's walks are short; the skill's clock
 *  (180 s) is the real bound, and the journal's order makes the first visit the hit in most towns. */
export const WITHDRAW_PICK_VISITS = 16
export const WITHDRAW_INGREDIENT_VISITS = 8
/** No visit starts with less than this left on the skill's clock (a walk is bounded at 30 s, an open at 8 s). */
export const WITHDRAW_VISIT_MIN_MS = 15_000
/** The pickaxe pass leaves the ingredient pass at least this much of the clock (it starts no visit inside it). */
export const WITHDRAW_INGREDIENT_RESERVE_MS = 40_000
/** A visit that could not look inside (unreachable, a lid it could not clear) keeps that container out of THIS bot's
 *  search this long, so the next order does not walk there first again. */
export const SEARCH_FAIL_SKIP_MS = 30 * 60 * 1000
/** The failures that say nothing about what the container holds -- the search moves on to the next one. */
export const SEARCH_FAIL_SKIP = new Set(['chest_unreachable', 'container_blocked'])

/** The stock journal's groups that count each need (stocktarget.mjs STOCK_GROUPS; a tool group counts only usable copies).
 *  An iron/golden/diamond pickaxe is not a stock group: the journal cannot see one, so a container is never ranked first
 *  for it -- a container with NO count stays in the search (unknown). */
const PLANK_GROUPS = STOCK_GROUP_NAMES.filter(g => /_planks$/.test(g))
export const NEED_GROUPS = Object.freeze({ pick: ['stone_pickaxe', 'wooden_pickaxe'], cobblestone: ['cobble'], stick: ['stick'], planks: PLANK_GROUPS })
/** One journal observation's count of a need -> number | null (null: that observation did not count it). Pure. */
export function needCount (o, need) {
  const gs = NEED_GROUPS[need]
  if (!o || !gs) return null
  let n = 0
  for (const g of gs) { const c = countOf(o, g); if (c == null) return null; n += c }
  return n
}

/**
 * THE ORDER TO LOOK IN THE TOWN'S CONTAINERS FOR `needs` -> [{ k, tier, cover, d }]. Pure.
 *   containers  [{ k, d }]: every town container (one key per double chest), d = distance from the bot
 *   needs       ['pick'] or the ingredient deficits (['cobblestone', 'stick', 'planks']); want[need] = how many (default 1)
 *   counts      { need: { k: { n, at } } }: the stock journal's latest count of the need in k (needCount), when it was taken
 *   misses      { need: { k: at } }: k was opened and held none of the need at `at`
 *   tookAt      { k: at }: the last deposit INTO k (the town's memory, o='took')
 *   skip        keys out of this search (already opened this order, a recent failed visit, a container the town shut)
 * Per need, a container is
 *   HAS      a count of n > 0 younger than countTtl (the journal's own 6 h), and newer than any live miss
 *   OUT      a live miss (younger than missTtl, no deposit since), or a count of 0 younger than missTtl with no deposit since
 *            -- a count is a look by whichever bot opened it last
 *   UNKNOWN  otherwise
 * Dropped when OUT for every need. Tier 0 = HAS for some need, tier 1 = the rest. Within a tier: most of the wanted
 * amount covered (cover, from the counts), then nearest, then key. Never the same container twice: one entry per key.
 */
export function townSearchOrder (containers = [], needs = [], { counts = {}, misses = {}, tookAt = {}, skip = [], want = {},
                                                               now = Date.now(), missTtl = SEARCH_MISS_TTL_MS, countTtl = OBS_TTL_MS } = {}) {
  const out = new Set(Array.isArray(skip) ? skip : [...(skip ?? [])])
  const seen = new Set()
  const res = []
  if (!Array.isArray(needs) || !needs.length) return res
  for (const c of (Array.isArray(containers) ? containers : [])) {
    const k = c?.k
    if (k == null || out.has(k) || seen.has(k)) continue
    seen.add(k)
    const took = Number.isFinite(tookAt?.[k]) ? tookAt[k] : -Infinity
    let has = false, cover = 0, allOut = true
    for (const need of needs) {
      const m = misses?.[need]?.[k]
      const missLive = Number.isFinite(m) && now - m < missTtl && !(took > m)
      const ct = counts?.[need]?.[k]
      const cAt = Number.isFinite(ct?.at) ? ct.at : null
      const n = Number(ct?.n)
      if (cAt != null && now - cAt < countTtl && n > 0 && !(missLive && m >= cAt)) {
        has = true; allOut = false
        cover += Math.min(n, Math.max(1, Number(want?.[need]) || 1))
        continue
      }
      const zeroLive = cAt != null && n === 0 && now - cAt < missTtl && !(took > cAt)
      if (missLive || zeroLive) continue
      allOut = false
    }
    if (allOut) continue
    res.push({ k, tier: has ? 0 : 1, cover, d: Number.isFinite(c.d) ? c.d : Infinity })
  }
  res.sort((a, b) => a.tier - b.tier || b.cover - a.cover || a.d - b.d || (a.k < b.k ? -1 : a.k > b.k ? 1 : 0))
  return res
}

/** The `_townsearch_mode` licence row (once per spawn): a kind the baseline cannot write. */
export const townSearchModeDetail = () =>
  `phase=mode search=town order=journal,unknown,nearest visits=${WITHDRAW_PICK_VISITS}+${WITHDRAW_INGREDIENT_VISITS} miss_ttl_min=${SEARCH_MISS_TTL_MS / 60000} fail_skip_min=${SEARCH_FAIL_SKIP_MS / 60000}`

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
/** Failures that moved nothing and say nothing about the town: no backoff beyond the cooldown. */
export const WITHDRAW_NO_BACKOFF = new Set(['recount_unanswered', 'chest_no_room'])
/** How long what was withdrawn is held back from deposit (bankable.mjs setWithdrawHold). */
export const HOLD_MS = 10 * 60 * 1000

/** The withdraw row (`_withdraw_pick`, from the order AND the model's verb): key=value, outcome first, the containers
 *  last (logEvent cuts at 300 characters). The order's row also says how many town containers its search saw (town=) and
 *  how many were candidates for the pickaxe and for the ingredients when each pass began (cand=pick,ing; townsearch-01). srv= is the server-recounted change of the bag; plan= the names planned to
 *  LEAVE it (room-making deposits and trades) -- a read can flag a server-counted fall of any name not in plan=. */
export function withdrawRow ({ outcome, need, uses = null, verification = 'none', cursor = '-', err = null, chestRoom = null, srv = '-', plan = '-',
                               bagBefore = 0, bagAfter = 0, deposited = [], took = {}, verb = 'withdraw_pick', tried = [], search = null } = {}) {
  const dep = deposited.map(d => `${d.name}:${d.count}`).join(',') || '-'
  const tk = Object.entries(took).map(([k, v]) => `${k}:${v}`).join(',') || '-'
  const clean = v => String(v ?? '-').replace(/\s+/g, '_').slice(0, 40)
  return (`outcome=${outcome} need=${need} uses=${uses ?? '-'} verification=${verification} cursor=${clean(cursor)} err=${clean(err)} ` +
          `chest_room=${chestRoom ?? '-'} plan=${plan || '-'} srv=${srv} bag=${bagBefore}->${bagAfter} deposited=${dep} took=${tk} verb=${verb} ` +
          (search ? `town=${search.town ?? '-'} cand=${search.pick ?? '-'},${search.ing ?? '-'} ` : '') +
          `tried=[${tried.join(';')}]`).slice(0, 300)
}
