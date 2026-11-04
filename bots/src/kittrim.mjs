// KITTRIM (kittrim-01; owner overnight grant 11-04 "implement, deploy, run, debug and fix ... bots use their time better").
// THE CARRIED TOOL KIT, TRIMMED: the best pickaxe + ONE spare, the best axe, the best shovel, the best hoe. This file is the
// LEAF half (the switch, the kept pickaxe pair, the wear-out list, the rows): it imports toolfor.mjs and townground.mjs only,
// so hygiene.mjs can import it. The bank half (kittrimbank.mjs) composes it with the guards that need heavier modules.
//
// MEASURED 11-04 (80 bots, newest inventory per bot; ~/mcai-analysis/bags-1104/toolspare.py, kittrim-split.py on .31):
//   tools fill 589 of 2,453 occupied bag slots (24%); 295 pickaxe copies (1:1 2:12 3:25 4:26 5:7 6:6 7:3 per bot).
//   Beyond the best pickaxe + 1 spare and the best axe / shovel: 169 pickaxe copies -- 153 WORN (<= FLOOR 10 uses; 102 of
//   them at exactly 1 use) and 17 usable (13 stone beside an iron/diamond one, 4 iron) -- and 60 usable axes (31 stone, 29
//   wooden, every one beside an iron axe), 7 usable shovels (2 stone, 5 wooden, beside an iron shovel).
//
// WHY THE COPIES STAY TODAY (each keep rule read before it was changed; git log -S and the reports):
//   - "the best usable copy of EACH NAME stays" (towndeposit toolSlotsToBank, bankable keep-one; 10-04, both reviews): a
//     transfer by type could bank the good copy and keep a spent one. Per NAME, so a stone_axe beside an iron_axe is "the
//     best stone_axe" and never moves. kittrim keeps the rule's purpose (it chooses copies by SLOT, never by type) and judges
//     the KIND (pickaxe / axe / shovel / hoe) instead of the name.
//   - "spent copies stay" (<= FLOOR uses never banked; owner 10-03 "never toss or drop"; toolkit-01 "THE SPENT COPIES GO BY
//     USE, NOT DOWN THE WELL"; stocktarget "a tool is NEVER disposed or pruned"): UNCHANGED. A worn copy is never banked
//     (nobody withdraws it: withdrawpick never takes a copy at or under FLOOR, so it would be chest junk -- owner 10-04 "never
//     deposit junk") and never thrown in the well (wellread C3 counts an off-list throw; NEVER_DISPOSE guards tools). kittrim
//     JUNKS BY USE: the wear-out (hygiene.mjs) destroys a 1-use copy with one dig and creates no item entity -- the owner's
//     "else stay until worn out" path, run earlier. Copies at 2-10 uses are already dug first (tool hygiene part 2).
//   - SPENT_PICKAXES_KEPT = 3 for last-swing (09-28: three spent swings mine the cobblestone of a new pickaxe when no working
//     one is left) and junkout-01's spentKeptUnderSpares: kittrim keeps NONE of the 1-use pickaxes only while the bag holds
//     TWO WORKING (> FLOOR) pickaxes -- the escape's two-pickaxe reserve (toolfor ESCAPE_RESERVE) is then met by working
//     copies, which is exactly toolkit-01's own rule ("two working pickaxes are the reserve") widened from iron+stone to any
//     two. With fewer than two working the deployed keeps stand.
//   - junkout-01 row P (OWNER 10-21 "at most 2 spare stone pickaxes beyond the best working pickaxe"): a MAXIMUM; one spare
//     is inside it. toolkit-01 (OWNER 10-15 "a bot with an iron pickaxe carries ONE stone pickaxe as its spare"): the spare
//     beside an iron-or-better best IS the best usable stone copy whenever there is one (iron retention: toolFor digs the
//     cheapest tier first, so the stone spare takes the stone and the iron is kept for the ores that need it).
//   - stocktarget-01 class C (owner-delegated design 10-08/10-10): a usable tool is banked only under the town's target for its
//     name (wooden axe/shovel and hoes 0, stone axe/shovel 4, stone pickaxe 16, wooden pickaxe 4). UNCHANGED: kittrim asks the
//     same room and the bank click's claim re-checks it. So a wooden axe beside an iron axe STAYS (target 0) -- reported, not
//     forced into a chest.
//
// Pure except the switch. KITTRIM=on|off, default on; anything else reads as on and the mode row says so.

import { remaining, FLOOR, HARD_STOP, tier, isPickaxe } from './toolfor.mjs'
import { TOWN_GROUND_HALF, TOWN_MARGIN } from './townground.mjs'

/** KITTRIM=on|off (the canary's kill switch), default on; anything else reads as on and the `_kittrim_mode` row says so. */
export function kittrimMode (env = {}) {
  const raw = env?.KITTRIM
  if (raw == null || String(raw).trim() === '') return { on: true, mode: 'on', note: 'KITTRIM unset' }
  const v = String(raw).trim().toLowerCase()
  if (v === 'on' || v === 'off') return { on: v === 'on', mode: v, note: null }
  return { on: true, mode: 'on', note: `KITTRIM=${String(raw).slice(0, 20)} unreadable, using on` }
}
export const KITTRIM = Object.freeze(kittrimMode(typeof process !== 'undefined' ? process.env : {}))

/** The kinds the kit trims. Swords are the peaceful kit's (peacefulkit.mjs); buckets/stations junkout-01's station row. */
export const KIT_KINDS = Object.freeze(['pickaxe', 'axe', 'shovel', 'hoe'])
const KIND_RE = /_(pickaxe|axe|shovel|hoe)$/
/** The kind of a tool name -> 'pickaxe' | 'axe' | 'shovel' | 'hoe' | null. */
export const kindOf = name => KIND_RE.exec(String(name ?? ''))?.[1] ?? null
/** Copies kept per kind: the pickaxe pair (best + one spare), one of each other kind. */
export const KEEP_PER_KIND = Object.freeze({ pickaxe: 2, axe: 1, shovel: 1, hoe: 1 })
/** The early wear-out (outside town, below hygiene's TRIGGER_SLOTS) starts at this many occupied slots: two thirds of the bag. */
export const KT_WEAR_SLOTS = 24

const working = it => remaining(it) > FLOOR
const IRON = tier('iron_pickaxe')
const bySlot = (a, b) => (a.slot ?? 0) - (b.slot ?? 0)
/** Highest tier, then most uses, then the lower slot (junkout row P's and spentKeptUnderSpares' "best working pickaxe"). */
export const byTierUses = (a, b) => tier(b.name) - tier(a.name) || remaining(b) - remaining(a) || bySlot(a, b)
const byUses = (a, b) => remaining(b) - remaining(a) || bySlot(a, b)

/**
 * THE KEPT PICKAXE PAIR -> { best, spare } (items or null). Pure.
 *   best   the highest-tier WORKING (> FLOOR) pickaxe, most uses, lower slot -- the harvest capability the bag has.
 *   spare  beside an iron-or-better best: the best usable STONE copy (toolkit-01's owner rule; iron retention), else the next
 *          working copy by tier and uses; with no second working copy, the fullest copy above HARD_STOP (a worn spare --
 *          the escape reserve counts copies above HARD_STOP; kittrim never banks a worn copy anyway).
 * No working pickaxe -> best null and spare null: nothing is trimmed (the deployed last-swing keeps decide).
 */
export function kitPickKeep (items = []) {
  const picks = (Array.isArray(items) ? items : []).filter(it => it?.name && isPickaxe(it.name))
  const work = picks.filter(working).sort(byTierUses)
  const best = work[0] ?? null
  if (!best) return { best: null, spare: null }
  const rest = work.slice(1)
  const stone = tier(best.name) >= IRON ? rest.filter(it => it.name === 'stone_pickaxe').sort(byUses)[0] : null
  const spare = stone ?? rest[0] ?? picks.filter(it => it !== best && !working(it) && remaining(it) > HARD_STOP).sort(byUses)[0] ?? null
  return { best, spare }
}

/**
 * THE SPENT COPIES KITTRIM JUNKS BY USE -> [items] (exactly 1 use left; hygiene.mjs wears them out). Pure.
 *   pickaxes  every 1-use copy, but only while the bag holds TWO WORKING (> FLOOR) pickaxes -- best + spare are then the
 *             escape reserve and last-swing has nothing to buy; with fewer, none (the deployed keeps decide)
 *   axe / shovel / hoe  a 1-use copy while the bag holds a working copy of the same KIND ("unless it is the only copy of its kind")
 * A copy the client shows at 0 has already broken (durability lags): never listed, as wearOutPlan. Pickaxes first, by slot.
 */
export function kitWearList (items = []) {
  const list = (Array.isArray(items) ? items : []).filter(it => it?.name && kindOf(it.name))
  const one = it => it.maxDurability && remaining(it) === 1
  const out = []
  const picks = list.filter(it => isPickaxe(it.name))
  if (picks.filter(working).length >= 2) out.push(...picks.filter(one).sort(bySlot))
  for (const k of ['axe', 'shovel', 'hoe']) {
    const of = list.filter(it => kindOf(it.name) === k)
    if (of.some(working)) out.push(...of.filter(one).sort(bySlot))
  }
  return out
}

/**
 * MAY THE EARLY WEAR-OUT RUN HERE? -> bool. Pure. The switch; a KNOWN home (unknown home = unknown town: fail closed); the bot
 * OUTSIDE the town's ground square (townground.mjs TOWN_GROUND_HALF + the instrument's TOWN_MARGIN, Chebyshev) AT ANY DEPTH --
 * the wear-out has no town-ground guard of its own, and the town stair runs straight down under the square, so a bot in the
 * stair (below the ground box's 12 blocks) is still "in town" here; and at least KT_WEAR_SLOTS occupied slots.
 */
export const KT_TOWN_HALF = TOWN_GROUND_HALF + TOWN_MARGIN
export function kitWearEarly ({ on = KITTRIM.on, pos = null, home = null, slots = 0 } = {}) {
  if (!on || !home || !pos) return false
  if (![home.x, home.y, home.z, pos.x, pos.z].every(Number.isFinite)) return false
  if (Math.abs(Math.floor(pos.x) - Math.floor(home.x)) <= KT_TOWN_HALF && Math.abs(Math.floor(pos.z) - Math.floor(home.z)) <= KT_TOWN_HALF) return false
  return (Number(slots) || 0) >= KT_WEAR_SLOTS
}

const tag = it => `${it.name}@${Number.isFinite(remaining(it)) ? remaining(it) : 'inf'}`
/** The `_kittrim` bank row (one per town deposit that planned a kit step) -> <= 300 chars. Pure. `banked` = the kit steps the
 *  SERVER showed in a chest on the re-open; `planned` the kit steps of the run's first plan; slots = the bag before -> after. */
export function kittrimBankDetail ({ mode = 'full', planned = [], banked = [], slotsBefore = null, slotsAfter = null, held = null } = {}) {
  const names = xs => xs.map(s => s.tag ?? `${s.name}@${s.uses ?? '?'}`).join(',') || '-'
  return (`phase=bank mode=${mode} planned=${planned.length} banked=${banked.length} freed=${banked.length} slots=${slotsBefore ?? '?'}->${slotsAfter ?? '?'}` +
          `${held ? ` held=${held}` : ''} tools=${names(banked)} plan=${names(planned)}`).slice(0, 300)
}
/** The `_kittrim` wear row (one per wear_out that listed a kit copy) -> <= 300 chars. Pure. */
export function kittrimWearDetail ({ early = false, listed = 0, worn = 0, of = 0, slotsBefore = null, slotsAfter = null, tools = [] } = {}) {
  return `phase=wear early=${early ? 1 : 0} listed=${listed} worn=${worn} of=${of} freed=${worn} slots=${slotsBefore ?? '?'}->${slotsAfter ?? '?'} tools=${tools.join(',') || '-'}`.slice(0, 300)
}
/** The `_kittrim_mode` licence row (once per spawn). Pure. */
export const kittrimModeDetail = (m = KITTRIM) =>
  `phase=mode on=${m.on ? 1 : 0} mode=${m.mode} keep=pickaxe:${KEEP_PER_KIND.pickaxe},axe:${KEEP_PER_KIND.axe},shovel:${KEEP_PER_KIND.shovel},hoe:${KEEP_PER_KIND.hoe} wear_slots=${KT_WEAR_SLOTS} floor=${FLOOR}${m.note ? ` note=${m.note.replace(/\s+/g, '_')}` : ''}`
export { tag as kitTag }
