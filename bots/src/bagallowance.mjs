// THE BAG ALLOWANCE (bagbudget-01; OWNER 2026-10-20 ~03:20Z "fix allowance ... yes i agree with your assessment and make
// those changes"). Design and evidence: docs/reports/bagbudget-01-design-2026-10-20.md.
//
// ONE TABLE. Every keep layer that had its own constant -- bankable.mjs (the cobble reserve, the recipe sticks, KEEP_ONE),
// towndeposit.mjs townKeeps (the stockpile, the goal keeps, the gather rung, the ladder means), stocktarget.mjs
// (STOCK_RESERVE), well.mjs (STONE_GUARD, COBBLE_WELL_RESERVE), hygiene.mjs (last-swing's spent pickaxes) and composter.mjs
// (the sapling and apple reserves) -- imports its number from here, and test/bagbudget.test.mjs holds each equal. Those
// numbers are UNCHANGED: the consolidation alone changes no behaviour.
//
// WHAT CHANGES (MEASURED 10-20 00:00-02:55Z, files, 80 bots): 38 bags at >= 34 of 36 slots, and in them ~3 slots per bag
// of things NO layer had an exit for -- bone_meal 40, ladders 35, torches 34, building stone 5 (of 1,349 slots).
// bankable.mjs judged them `not_wanted` (never banked), the junk well never takes them (the owner's list) and the composter
// only plant litter, so a full bag at town kept them for good: 646 of 646 town-deposit no_effect runs in 24 h were bags
// whose plan was empty. Under this table a bag at >= TRIGGER slots AT TOWN banks the surplus of the CHEST ROWS below
// (whole stacks, smallest first, while what remains >= the row's kept amount) at the town deposit, AFTER the well and the
// composter have had their turn (deletion first, bounded) -- and nowhere else: the surplus is never the reason for a
// deposit, a walk, a trip, a new chest or the deposit rung (kitshrink-01's rule, both engines), because depositPlan never
// sees it. Junk, compost inputs and saplings are never a chest's (owner 10-04); an UNLISTED name stays (allowlist polarity).
//
// A WHOLE KIND OR NOTHING. Every row here is about a STACKABLE kind, and a kind that fits one stack is one slot: banking 2 of
// 3 crafting tables frees nothing (a partial stack is never moved). So a row keeps either the whole kind (stations, the
// best sapling and food stacks, 26+ ladders) or none of it.
//
// Pure, and a LEAF: imports only ladder.mjs (no imports of its own), so every layer can import it without a cycle.
import { ladderPlan } from './ladder.mjs'

/** BAG_ALLOWANCE=on|off, default on; anything else reads as on and the mode row says so. Pure. */
export function bagAllowanceMode (env = {}) {
  const raw = env?.BAG_ALLOWANCE
  if (raw == null || String(raw).trim() === '') return { on: true, mode: 'on', note: null }
  const v = String(raw).trim().toLowerCase()
  if (v === 'on' || v === 'off') return { on: v === 'on', mode: v, note: null }
  return { on: true, mode: 'on', note: `BAG_ALLOWANCE=${String(raw).slice(0, 20)} unreadable, using on` }
}
export const BAG_ALLOWANCE = Object.freeze(bagAllowanceMode(typeof process !== 'undefined' ? process.env : {}))

/**
 * THE STRANDED-ESCAPE LADDER CLIMB (reflex.mjs ladderReady: `need = PILLAR_MAX_BLOCKS + 1` = 25, a test holds it): the
 * fewest ladders ladderPlan accepts for that climb -- asked of ladderPlan, never restated (kitshrink-01's rule).
 */
export const LADDER_CLIMB_NEED = 25
export const LADDER_ESCAPE_MIN = (() => {
  for (let h = 1; h <= 64 * 36; h++) if (ladderPlan({ need: LADDER_CLIMB_NEED, have: h, reach: LADDER_CLIMB_NEED }).ok) return h
  return Infinity
})()

/**
 * THE NUMBERS. Each is the one place a layer's keep is written (the layer imports it; the test holds them equal).
 *   cobble          cobblestone + cobbled_deepslate kept together (bankable COBBLE_RESERVE, well STONE_GUARD and
 *                   COBBLE_WELL_RESERVE): the exit contract's iron-depth descent needs 59
 *   stack           one stack of a targeted group (stocktarget STOCK_RESERVE)
 *   stockpile       wood units and the stone family (towndeposit STOCKPILE_KEEP = milestones STOCKPILE_MAX)
 *   wanted          a name the active rung wants, or one of its ingredients (towndeposit WANTED_KEEP): the goal wins
 *   planksMeans     the pickaxe/table rungs' planks (towndeposit PLANKS_MEANS)
 *   recipeSticks    a stone pickaxe's sticks (bankable RESERVE_RECIPE)
 *   dirt, sand      the gatherer chain's held targets (towndeposit HELD_TARGETS)
 *   spentPickaxes   spent pickaxes last-swing keeps (hygiene SPENT_PICKAXES_KEPT) -- and 0 under the allowance while the
 *                   bag holds lastSwingCobble cobble: last-swing exists to mine the cobble for the next stone pickaxe
 *   saplingReserve, appleReserve   the composter's (composter.mjs SAPLING_RESERVE, APPLE_RESERVE)
 *   station         each station and bucket (bankable KEEP_ONE)
 */
export const ALLOWANCE = Object.freeze({
  cobble: 64, stack: 64, stockpile: 64, wanted: 64, planksMeans: 4, recipeSticks: 2, dirt: 16, sand: 8,
  spentPickaxes: 3, lastSwingCobble: 3, saplingReserve: 16, appleReserve: 4, station: 1,
  torch: 0, ladder: 0, boneMeal: 0, other: 0,
})

/** Row K: one of each station and bucket stays (the tech ladder is satisfied by HOLDING them; the carried chest is the
 *  full-town recovery's). bankable.mjs KEEP_ONE is this list. */
export const STATIONS = Object.freeze(['crafting_table', 'furnace', 'blast_furnace', 'smoker', 'chest', 'barrel', 'composter',
  'bucket', 'water_bucket', 'lava_bucket', 'milk_bucket'])
const STATION_SET = new Set(STATIONS)
/** bankable.mjs KEEP_ONE's original seven (the chest and barrel are kept by the allowance row, not by bankable). */
export const KEEP_ONE_NAMES = Object.freeze(['crafting_table', 'furnace', 'blast_furnace', 'smoker', 'bucket', 'water_bucket', 'lava_bucket'])

/**
 * Row R: KEPT WHOLE whatever the default row says -- each has a consumer here or is a player's kit: beds (sleep), slabs (the
 * composter is crafted from 7), trapdoors (the well is built from them), doors, shears, flint and steel, bows, shields,
 * armour, fishing rods, boats, compass/clock/map, name tags, saddles, golden apples.
 */
export const KEPT_WHOLE = /(_bed$|_slab$|_trapdoor$|_door$|_(helmet|chestplate|leggings|boots)$|_boat$|_chest_boat$|_raft$|^(shears|flint_and_steel|bow|crossbow|shield|fishing_rod|compass|recovery_compass|clock|map|filled_map|name_tag|saddle|golden_apple|enchanted_golden_apple|totem_of_undying|elytra|trident|spyglass|brush|goat_horn|bundle)$)/

/**
 * Row F: THE FOODS THE BOT EATS, best first -- reflex.mjs FOOD_PRIORITY (a test holds them equal; Claude design r1 P2-7: a
 * food-points rank kept raw salmon and banked the steak the eating reflex would actually take). The bag keeps its one
 * best-ranked food stack; another eaten food leaves. A food the reflex never eats is on no row (it stays: allowlist polarity).
 */
export const FOOD_PRIORITY = Object.freeze(['golden_carrot', 'cooked_beef', 'cooked_porkchop', 'cooked_mutton',
  'cooked_chicken', 'bread', 'baked_potato', 'cooked_cod', 'cooked_salmon', 'apple', 'carrot', 'melon_slice', 'sweet_berries'])
export const isEatenFood = name => FOOD_PRIORITY.includes(name)
/**
 * Row M, A NAMED LIST (Claude design r1 P1-2: the bank's founding rule is allowlist polarity -- an unlisted name is never a
 * chest's by default). The town's building stone (well.mjs BUILDING_STONES, OWNER D8 10-15: the hall's walls, the blast
 * furnaces; a test holds them equal). Every other name no row lists STAYS in the bag, and the read reports the unlisted
 * names a full bag holds, for the owner's junk-list call.
 */
export const BUILDING_CHEST = Object.freeze(['stone_bricks', 'smooth_stone'])
export const isSaplingName = name => typeof name === 'string' && /(_sapling|_propagule)$/.test(name)

/**
 * WHICH ROW A NAME IS IN -> 'station' | 'torch' | 'ladder' | 'bone_meal' | 'food' | 'building' | 'kept' | 'unlisted'.
 * Pure. The caller removes every name another layer owns first (tools, targeted groups, the iron ladder, the bank's
 * standing targets, junk, compost inputs, saplings): this table only speaks for what no other layer had an exit for.
 * 'kept' (row R) and 'unlisted' keep the whole kind.
 */
export function allowanceRow (name) {
  if (typeof name !== 'string') return null
  if (STATION_SET.has(name)) return 'station'
  if (name === 'torch') return 'torch'
  if (name === 'ladder') return 'ladder'
  if (name === 'bone_meal') return 'bone_meal'
  if (KEPT_WHOLE.test(name)) return 'kept'
  if (isEatenFood(name)) return 'food'
  if (BUILDING_CHEST.includes(name)) return 'building'
  return 'unlisted'
}

const countsOf = items => {
  const c = {}
  for (const it of (Array.isArray(items) ? items : [])) if (it?.name) c[it.name] = (c[it.name] ?? 0) + (Number(it.count) || 0)
  return c
}
/** Row F's one kept food: the held eaten food highest in FOOD_PRIORITY that holds at least FOOD_MIN (a lone golden carrot
 *  does not send 64 steak to the chest: Claude design r2 P3-6); else the highest held at all; or null. Pure. */
export const FOOD_MIN = 4
export const bestFood = (counts = {}) => FOOD_PRIORITY.find(n => (Number(counts[n]) || 0) >= FOOD_MIN) ?? FOOD_PRIORITY.find(n => (Number(counts[n]) || 0) > 0) ?? null

/**
 * WHAT THE ROW KEEPS of `name` in a bag with these counts -> a number (Infinity = the whole kind). Pure.
 */
export function rowKeep (name, counts = {}) {
  switch (allowanceRow(name)) {
    case 'station': return ALLOWANCE.station
    case 'torch': return ALLOWANCE.torch
    case 'bone_meal': return ALLOWANCE.boneMeal
    case 'ladder': return (Number(counts.ladder) || 0) >= LADDER_ESCAPE_MIN ? Infinity : ALLOWANCE.ladder
    case 'food': return bestFood(counts) === name ? Infinity : 0
    case 'building': return ALLOWANCE.other
    default: return Infinity      // 'kept', 'unlisted'
  }
}

/**
 * THE CHEST ROWS' SURPLUS -> [{ slot, name, count, row }]: whole stacks, smallest first per name, while what remains of
 * the name stays >= its keep. Pure over mineflayer Items ({ name, count, slot }).
 *   owned(name)  true when another layer owns the name (tools, targeted groups, the iron ladder, the bank's own plan,
 *                junk, a withdraw hold): never listed here
 *   keeps        { name: n } other floors (townKeeps: the goal, the stockpile ...): the keep is max(row, floor)
 *   room(name)   how many of the name this visit may still move (the visit's CREDIT_CAP less what it moved): default Infinity
 */
export function allowanceSteps (items = [], { owned = () => false, keeps = {}, room = () => Infinity } = {}) {
  const list = (Array.isArray(items) ? items : []).filter(it => it?.name && (Number(it.count) || 0) > 0)
  const counts = countsOf(list)
  const out = []
  for (const name of Object.keys(counts).sort()) {
    if (owned(name)) continue
    const keep = Math.max(rowKeep(name, counts), Math.max(0, Number(keeps?.[name]) || 0))
    if (!Number.isFinite(keep)) continue
    let left = Math.min(counts[name] - keep, Math.max(0, Number(room(name)) || 0))
    if (!(left > 0)) continue
    const copies = list.filter(it => it.name === name).sort((a, b) => a.count - b.count || (a.slot ?? 0) - (b.slot ?? 0))
    for (const it of copies) {
      if (it.count > left) break
      out.push({ slot: it.slot, name, count: it.count, row: allowanceRow(name) })
      left -= it.count
    }
  }
  return out
}

/** The licence row's detail (once per process: `_bagbudget_mode`). */
export function bagBudgetModeDetail (mode = BAG_ALLOWANCE) {
  return `phase=mode on=${mode.on ? 1 : 0} mode=${mode.mode} rows=station:1,torch:0,ladder:0<${LADDER_ESCAPE_MIN},bone_meal:0,food:1kind,building:0 cobble=${ALLOWANCE.cobble} spent_picks=${ALLOWANCE.spentPickaxes}/0@cobble${ALLOWANCE.lastSwingCobble}${mode.note ? ` note=${String(mode.note).replace(/\s+/g, '_')}` : ''}`
}

/**
 * THE BANK ROWS (`_bagbudget phase=bank`): what the allowance planned (`allow`: its names, the START count : the SERVER-
 * verified banked) and EVERY other name the visit banked (`other`) -- the read's junk-into-chest gate reads both, and the
 * town_deposit detail is cut at 300 and sorts by count. COMPLETE, IN PARTS (Codex design r2 P2-3): when one row would pass
 * 300 the names continue on further rows, each `part=i/n`, every part carrying the counts. -> [detail]. Pure.
 */
export function bagBudgetBankDetails ({ planned = [], heldBefore = {}, banked = {}, slotsBefore = null, slotsAfter = null, peaceful = null } = {}) {
  const allow = [...new Set(planned.map(s => s.name))].sort()
  const rows = {}
  for (const s of planned) rows[s.row] = (rows[s.row] ?? 0) + 1
  const n = v => Math.max(0, Number(v) || 0)
  const got = allow.reduce((t, k) => t + n(banked?.[k]), 0)
  const other = Object.keys(banked ?? {}).filter(k => n(banked[k]) > 0 && !allow.includes(k)).sort()
  // peaceful= the switch the plan read (the read's junk gate is conditional on it: Claude design r2 P3-5)
  const head = `phase=bank peaceful=${peaceful == null ? '?' : peaceful ? 1 : 0} stacks=${planned.length} banked=${got} slots=${slotsBefore ?? '?'}->${slotsAfter ?? '?'} ` +
    `rows=${Object.entries(rows).sort().map(([k, v]) => `${k}:${v}`).join(',') || '-'}`
  const tokens = [...allow.map(k => `allow=${k}=${n(heldBefore?.[k])}:${n(banked?.[k])}`), ...other.map(k => `other=${k}:${n(banked[k])}`)]
  const parts = [[]]
  const len = p => `${head} part=99/99 ${p.join(' ')}`.length
  for (const t of tokens) {
    const cur = parts[parts.length - 1]
    if (cur.length && len([...cur, t]) > 300) parts.push([t]); else cur.push(t)
  }
  return parts.map((p, i) => `${head} part=${i + 1}/${parts.length} ${p.join(' ') || '-'}`.slice(0, 300))
}

/** The full-bag no_effect row (`_bagbudget phase=none`): the chest rows' surplus (0 by construction) and the classes. */
export function bagBudgetNoneDetail ({ slots = 0, chest = 0, rows = true, classes = [] } = {}) {
  return `phase=none slots=${slots} chest=${chest} rows=${rows ? 1 : 0} left=${[...new Set(classes)].sort().join(',') || '-'}`.slice(0, 300)
}
