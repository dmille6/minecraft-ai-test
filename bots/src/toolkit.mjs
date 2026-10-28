// THE TOOLKIT (toolkit-01; owner-approved 10-15 ~20:30Z): a bot with an iron pickaxe carries ONE stone pickaxe as its
// spare, and every bot carries an iron axe and an iron shovel made from the town's iron. Pure here; hygiene.mjs (the
// spent-copy keep), cognitive.mjs (the order) and skills.mjs (`toolkit`: the draw and the crafts) use it.
//
// MEASURED FIRST (Elasticsearch, 24 h to 10-15 20:40Z, 80 bots, every bot carries bot.tools):
//   - 21 of 80 bots hold a usable iron pickaxe (> FLOOR uses). Their USABLE stone pickaxes: 0 copies 3 bots, 1 copy
//     16, 2 copies 2 -- only 2 usable copies beyond one spare in the whole fleet, and the town deposit already banks
//     those (bankable.mjs: one usable copy per name stays, the others go under stocktarget's stone_pickaxe target 16).
//     What they DO carry is SPENT stone pickaxes: 27 copies, 23 of them at exactly 1 use (80 fleet-wide at 1 use).
//     wear_out keeps SPENT_PICKAXES_KEPT = 3 of those for last-swing (three cobblestone for a new pickaxe when no
//     working pickaxe is left) -- a reserve a bot holding TWO working pickaxes does not need. Part 1 is that keep.
//   - 0 of 80 bots hold an iron axe or an iron shovel; 22 hold an axe (20 stone, 4 wooden), 5 a stone shovel.
//     Log gather, seconds per log gained: no axe 16.0 (n 2,320 runs), stone axe 9.7 (152), wooden 15.1 (125) --
//     observational (walking is in it), the same direction as the dig times (a log: hand 3.0 s, iron axe 0.5 s;
//     dirt: hand 0.75 s, iron shovel 0.15 s; prismarine-block 1.21.8). Soil: none 7.8, stone shovel 7.1.
//   - The town chests hold 45-188 iron ingots per town after the 10-14 clear (census), in 8-20 containers each, and
//     nothing draws them. Five bots x (3 + 1) ingots is 20 per town.
//
// THE SPENT COPIES GO BY USE, NOT DOWN THE WELL (a deliberate deviation, said in the reviews and the report): a tool
// thrown into the junk well is an off-list throw to wellread.py's C3 (items= names it, LISTED does not), so every later
// canary that registers wellread would see a REVERT gate fire on its own arm; changing wellread changes the md5 every
// queued entry pinned. wear_out destroys a 1-use copy with one dig, verified by the slot, and creates no item entity at
// all. The owner's "else stay until worn out" is this path.

import { remaining, FLOOR, HARD_STOP, tier, isPickaxe } from './toolfor.mjs'
import { RUNNER_DECLINED } from './declined.mjs'

/** TOOLKIT=on|off, default on; anything else reads as on and the process says so in its `_toolkit` mode row. */
export function toolkitMode (env = {}) {
  const raw = env?.TOOLKIT
  if (raw == null || String(raw).trim() === '') return { on: true, mode: 'on', note: 'TOOLKIT unset' }
  const v = String(raw).trim().toLowerCase()
  if (v === 'on' || v === 'off') return { on: v === 'on', mode: v, note: null }
  return { on: true, mode: 'on', note: `TOOLKIT=${String(raw).slice(0, 20)} unreadable, using on` }
}
export const TOOLKIT = Object.freeze(toolkitMode(typeof process !== 'undefined' ? process.env : {}))

// ---- THE IRON PICKAXE (ironpick-01; OWNER 2026-10-20 ~03:20Z "add pickaxe to toolkit") ---------------------------------
// MEASURED 10-20: the town chests held 2,324 iron ingots (80-240 per town; RCON census 00:15Z, read-only; every town has 2-8
// containers holding >= 7 + TOWN_IRON_KEEP) while 25 of 80 bots held a usable iron pickaxe (59 held one, mostly worn), and 39
// iron_pickaxe crafts failed 10-19 "short 3x iron_ingot": the kit was the axe and the shovel only, withdraw_pick fetches stone
// and wooden copies only, so an iron pickaxe came only from ingots a bot happened to carry. Now the kit also makes one from the
// town's iron (3 ingots + 2 sticks) when the bag has no iron pickaxe above the trip line (withdrawpick PREFER_USES = 40) -- a
// worn copy (<= 40 uses), or none -- and no usable diamond/netherite one. The worn copy is not moved: toolFor digs the
// most-worn copy of a name first (tool hygiene), and a copy at or under FLOOR is spent by use (hasKeeper / last swing).

/** TOOLKIT_IRONPICK=on|off, default on (the one-setting rollback); anything else reads as on, said in the mode row. */
export function toolkitIronpickMode (env = {}) {
  const raw = env?.TOOLKIT_IRONPICK
  if (raw == null || String(raw).trim() === '') return { on: true, mode: 'on', note: 'TOOLKIT_IRONPICK unset' }
  const v = String(raw).trim().toLowerCase()
  if (v === 'on' || v === 'off') return { on: v === 'on', mode: v, note: null }
  return { on: true, mode: 'on', note: `TOOLKIT_IRONPICK=${String(raw).slice(0, 20)} unreadable, using on` }
}
export const TOOLKIT_IRONPICK = Object.freeze(toolkitIronpickMode(typeof process !== 'undefined' ? process.env : {}))
/** The trip line: withdrawpick.mjs PREFER_USES (= oretunnel MIN_TRIP_USES), restated -- importing withdrawpick here closes an
 *  import cycle (withdrawpick -> craftroom -> hygiene -> this); ironpick.test.mjs asserts the two are equal. */
export const IRONPICK_TRIP_USES = 40

const usable = it => !!it?.name && remaining(it) > FLOOR
const list = items => (Array.isArray(items) ? items : []).filter(it => it?.name)
const IRON_TIER = tier('iron_pickaxe')

/** A usable pickaxe of iron tier or better (iron, diamond, netherite) in the bag. */
export const ironPickHeld = items => list(items).some(it => isPickaxe(it.name) && tier(it.name) >= IRON_TIER && usable(it))

/**
 * DOES THE KIT MAKE AN IRON PICKAXE FOR THIS BAG? -> bool. Pure. True when the switch is on and the bag holds NO pickaxe
 * that covers it: an iron copy with MORE than IRONPICK_TRIP_USES uses left, or a usable (> FLOOR) diamond/netherite copy.
 * So: no pickaxe, only stone/wooden/golden ones, or an iron copy at <= 40 uses -> true. Unknown durability counts as full
 * (toolfor remaining), the direction toolfor chose.
 */
export function ironPickNeed (items = [], { on = TOOLKIT_IRONPICK.on } = {}) {
  if (!on) return false
  return !list(items).some(it => isPickaxe(it.name) && (tier(it.name) === IRON_TIER ? remaining(it) > IRONPICK_TRIP_USES : tier(it.name) > IRON_TIER && usable(it)))
}

/**
 * PART 1 -> { applies, spare, extra, spent }. Pure over mineflayer Items.
 *   spare   the best USABLE stone pickaxe (most uses, then the lower slot), or null
 *   extra   the other usable stone copies (the town deposit's tool rule banks these; reported, never moved here)
 *   spent   stone copies at <= FLOOR uses
 *   applies a usable iron-or-better pickaxe AND a usable stone spare: two working pickaxes, so the last-swing reserve of
 *           spent copies is not needed (hygiene.mjs wearOutPlan keeps none of the spent STONE copies then).
 * Without a usable spare nothing changes: the spent copies are then the bot's only second pickaxe material.
 */
export function stoneSpare (items = []) {
  const stones = list(items).filter(it => it.name === 'stone_pickaxe')
  const good = stones.filter(usable).sort((a, b) => remaining(b) - remaining(a) || (a.slot ?? 0) - (b.slot ?? 0))
  const spare = good[0] ?? null
  return { applies: ironPickHeld(items) && !!spare, spare, extra: good.slice(1), spent: stones.filter(it => !usable(it)) }
}

/** How many SPENT (1-use) stone pickaxes wear_out keeps for last-swing: 0 under the toolkit rule, else `base`. */
export const spentStoneKept = (items = [], base = 3, on = TOOLKIT.on) => (on && stoneSpare(items).applies ? 0 : base)

// ---- PART 2: the iron axe and shovel -----------------------------------------------------------------------------------

/** The kit, in craft order: ingots and sticks per tool (1.21 recipes: pickaxe 3 ingots + 2 sticks, axe 3 + 2, shovel 1 + 2).
 *  THE PICKAXE FIRST (ironpick-01): a draw or a credit that cannot fund every tool makes the one the bot digs its way out with. */
export const KIT = Object.freeze({ iron_pickaxe: Object.freeze({ ingots: 3, sticks: 2 }), iron_axe: Object.freeze({ ingots: 3, sticks: 2 }),
                                   iron_shovel: Object.freeze({ ingots: 1, sticks: 2 }) })
export const KIT_NAMES = Object.freeze(Object.keys(KIT))
/** The most ingots one kit run draws: the whole kit's (7), or the axe and shovel's (4) with TOOLKIT_IRONPICK off. Pure. */
export const kitMaxIngots = (ironpick = TOOLKIT_IRONPICK.on) => KIT_NAMES.reduce((t, n) => t + (n === 'iron_pickaxe' && !ironpick ? 0 : KIT[n].ingots), 0)
/** Sticks the bag keeps after the kit: the stone-pickaxe recipe's two (bankable.mjs RESERVE_RECIPE). */
export const STICK_KEEP = 2
/** Ingots a town container KEEPS after a kit draw: a container is drawn from only when it holds the draw + this. */
export const TOWN_IRON_KEEP = 4
/** The town memory's need name for "this container held too little iron for a kit" (withdrawpick's ingredient-miss map). */
export const KIT_IRON_NEED = 'kit_iron'
export const TOOLKIT_COOLDOWN_MS = 10 * 60 * 1000
export const TOOLKIT_BACKOFF_MS = 30 * 60 * 1000

const BAG_SLOTS = 36
const held = (items, name) => list(items).reduce((n, it) => n + (it.name === name ? (it.count ?? 0) : 0), 0)

/** The kit tools this bag has no USABLE copy of (a spent copy is a consumable toolfor uses up first: not "held"); the iron
 *  pickaxe by ironPickNeed (the trip line, not FLOOR: a worn copy is replaced, never moved). */
export const kitNeeds = (items = [], { ironpick = TOOLKIT_IRONPICK.on } = {}) =>
  KIT_NAMES.filter(n => (n === 'iron_pickaxe' ? ironPickNeed(items, { on: ironpick }) : !list(items).some(it => it.name === n && usable(it))))

/**
 * WHAT THE KIT MUST DRAW FROM TOWN -> { ingots, sticks, needs }. Pure.
 *   ingots  the recipes' ingots less `credit` (ingots an earlier kit run drew and no craft consumed): never the bag's own
 *           iron -- that is the ladder's (bucket, the next iron pickaxe), and towndeposit keeps every ingot for it.
 *   sticks  enough that the bag still holds STICK_KEEP after the crafts.
 */
// `limit` (ironpick-01, Claude r1 P2): the first `limit` needs in kit order only -- the PREFIX a run may draw for when the town
// cannot give the whole kit's draw from one container (kitPrefixes)
export function kitDraw (items = [], { credit = 0, ironpick = TOOLKIT_IRONPICK.on, limit = null } = {}) {
  const all = kitNeeds(items, { ironpick })
  const needs = Number.isInteger(limit) && limit >= 1 ? all.slice(0, limit) : all
  const want = needs.reduce((t, n) => t + KIT[n].ingots, 0)
  const c = Math.max(0, Math.min(Number(credit) || 0, held(items, 'iron_ingot'), want))
  const sticksNeed = needs.reduce((t, n) => t + KIT[n].sticks, 0)
  return { needs, ingots: want - c, sticks: needs.length ? Math.max(0, sticksNeed + STICK_KEEP - held(items, 'stick')) : 0 }
}

/**
 * THE ROOM A KIT RUN NEEDS -> the takes a room plan (withdrawpick roomPlan) is judged on. Pure. The draw's ingots and sticks
 * and, with TOOLKIT_IRONPICK on, ONE SLOT PER TOOL THE CRAFTS MAKE (ironpick-01): a crafted tool lands in a new slot while the
 * ingot stack it came from is still there (7 drawn, 3 used), so a bag with room for the draw alone could not take the tools,
 * and the craft's own make-room (craftroom) only wears out spent copies -- a draw into a bag that cannot take its output ended
 * craft_failed with the iron carried. Conservative: no slot freed by a consumed stack is counted. Off, or a draw without the
 * pickaxe (the axe and the shovel only): the draw's takes only (the base rule exactly).
 */
export function kitRoomTakes (d = {}, { ironpick = TOOLKIT_IRONPICK.on } = {}) {
  const takes = [{ name: 'iron_ingot', count: Math.max(0, Number(d.ingots) || 0) }, { name: 'stick', count: Math.max(0, Number(d.sticks) || 0) }].filter(t => t.count > 0)
  // ONLY A DRAW THAT MAKES THE PICKAXE (Claude r1 P3: one variable): an axe-and-shovel run keeps the base's room rule exactly
  return ironpick && (d.needs ?? []).includes('iron_pickaxe') ? [...takes, ...d.needs.map(n => ({ tool: true, name: n }))] : takes
}

/**
 * CAN THE CRAFT FINISH FROM THIS BAG? -> { tableOk, sticksMakeable }. Pure. The `craft` skill's own remedy chain
 * (skills.mjs craftLevel): a table within its 32-block search, or a carried one it places, or one it crafts from 4 planks;
 * sticks crafted from planks (2 -> 4), planks from logs (1 -> 4). So: wood = planks + 4 x logs; the table takes 4 of it when
 * none is near or carried; what is left makes floor(left / 2) x 4 sticks. Used so iron is never drawn for a craft the bag
 * cannot finish (the read's K3: iron withdrawn, no tool made).
 */
const PLANKS_RE = /_planks$/, LOG_RE = /_(log|stem)$/
export function kitMeans (items = [], { tableNear = false } = {}) {
  const carried = held(items, 'crafting_table') > 0
  const wood = list(items).reduce((n, it) => n + (PLANKS_RE.test(it.name) ? (it.count ?? 0) : LOG_RE.test(it.name) ? 4 * (it.count ?? 0) : 0), 0)
  const tableOk = !!tableNear || carried || wood >= 4
  const left = Math.max(0, wood - (tableNear || carried ? 0 : 4))
  return { tableOk, sticksMakeable: Math.floor(left / 2) * 4 }
}

/**
 * WHAT TO TAKE FROM THIS CONTAINER -> { takes: [{ name, count }], why } | { takes: [], why }. Pure over the container's
 * items. The ingots come from ONE container that keeps TOWN_IRON_KEEP after the take, or not from this one at all (the
 * town keeps a floor in every container it draws from); sticks ride along when this container has them (as many as it
 * has, up to the shortfall: the craft makes the rest from planks).
 */
export function kitTakes (inChest = [], draw = {}, { keep = TOWN_IRON_KEEP, sticksMakeable = Infinity } = {}) {
  const ingots = Math.max(0, Number(draw.ingots) || 0), sticks = Math.max(0, Number(draw.sticks) || 0)
  const st = Math.min(sticks, held(inChest, 'stick'))
  const have = held(inChest, 'iron_ingot')
  // THE IRON FIRST (toolkit-03, Codex r1 P1): a container short of iron is a miss whatever the sticks -- judged before the
  // sticks, or an empty chest read as `no_sticks` and was never remembered, so a stickless bot revisited it every run
  if (ingots > 0 && have < ingots + keep) return { takes: [], why: `holds ${have} iron_ingot, a kit draw needs ${ingots} + ${keep} kept`, ironHeld: have }
  // NO IRON FOR A CRAFT THAT CANNOT FINISH: the sticks this container cannot give must be makeable from the bag's wood
  if (ingots > 0 && sticks - st > sticksMakeable) return { takes: [], why: `${sticks - st} stick(s) short and the bag's wood makes ${sticksMakeable}`, noSticks: true }
  const takes = []
  if (ingots > 0) takes.push({ name: 'iron_ingot', count: ingots })
  if (st > 0) takes.push({ name: 'stick', count: st })
  return { takes, why: takes.length ? null : 'holds nothing the kit draws' }
}

// ---- KITMULTI-01: THE DRAW COMES FROM SEVERAL CONTAINERS, AND THE KEEP IS THE TOWN'S ---------------------------------------
// MEASURED 10-28 (ES 24 h to 22:30Z, 80 bots; the 16 live towns' index files, latest observation per container): 673 of 1,048
// toolkit runs failed kit_no_iron ("no town container holds N iron ingot(s) with TOWN_IRON_KEEP(4) to spare"). 194 of 312 town
// containers hold EXACTLY 4 ingots -- the per-container keep is where every draw left them -- so in 12 of 16 towns the fullest
// container holds 4-6 while the town holds 34-88 (all 16: 34-182). The three towns with one container above 11 (17, 47, 55
// ingots: board-b, placebo-b, hive-c) had 1 kit_no_iron between them; the other 13 had 672. Now (TOOLKIT_MULTI on) a run takes
// what each container it opens holds, nearest first, until the draw is met, while the TOWN keeps TOWN_IRON_RESERVE ingots by
// the index's latest observations; a draw the town cannot fund above that reserve is not ordered. A run that drew part of its
// draw crafts what that funds (the pickaxe first) and keeps the rest as credit (creditAfter), as a failed run always did.

/** TOOLKIT_MULTI=on|off, default on (the one-setting rollback: off is the one-container rule exactly). */
export function toolkitMultiMode (env = {}) {
  const raw = env?.TOOLKIT_MULTI
  if (raw == null || String(raw).trim() === '') return { on: true, mode: 'on', note: 'TOOLKIT_MULTI unset' }
  const v = String(raw).trim().toLowerCase()
  if (v === 'on' || v === 'off') return { on: v === 'on', mode: v, note: null }
  return { on: true, mode: 'on', note: `TOOLKIT_MULTI=${String(raw).slice(0, 20)} unreadable, using on` }
}
export const TOOLKIT_MULTI = Object.freeze(toolkitMultiMode(typeof process !== 'undefined' ? process.env : {}))
/** Ingots the TOWN keeps after any kit draw (the sum of its containers' latest index observations). */
export const TOWN_IRON_RESERVE = 16
/** The town memory's need name for "this container held no iron ingot at all" (a multi-container draw takes any). */
export const KIT_IRON_ANY = 'kit_iron_any'

/**
 * THE TOWN'S IRON BY THE INDEX -> { total, spare, containers } | null. Pure. `entries` the town index's fold ({ k: entry });
 * total = the iron ingots in every container's latest observation (any state: the reserve is a floor on what the bots have
 * seen, not a ledger), spare = total - reserve (never below 0). null when the index has no entry (unread, or a new town): the
 * caller then keeps the one-container rule.
 */
export function townIronSpare (entries = null, reserve = TOWN_IRON_RESERVE) {
  if (!entries || typeof entries !== 'object') return null
  const list = Object.values(entries)
  if (!list.length) return null
  let total = 0, containers = 0
  for (const e of list) {
    const n = Math.max(0, Number(e?.obs?.names?.iron_ingot?.[0]) || 0)
    total += n
    if (n > 0) containers++
  }
  return { total, spare: Math.max(0, total - Math.max(0, Number(reserve) || 0)), containers }
}

/**
 * WHAT TO TAKE FROM THIS CONTAINER IN A MULTI-CONTAINER DRAW -> { takes, why, ironHeld, noSticks? }. Pure. `left` the draw
 * still to take ({ ingots, sticks }), `budget` the ingots the town may still give above its reserve. The container gives
 * min(left.ingots, what it holds, budget) -- no per-container floor -- and its sticks up to the shortfall. As kitTakes: a
 * container with no iron gives nothing (sticks only ride with iron), and no iron is taken toward a craft whose sticks neither
 * this container nor the bag's wood can make.
 */
export function kitTakesMulti (inChest = [], left = {}, { budget = Infinity, sticksMakeable = Infinity } = {}) {
  const ingots = Math.max(0, Number(left.ingots) || 0), sticks = Math.max(0, Number(left.sticks) || 0)
  const have = held(inChest, 'iron_ingot')
  const st = Math.min(sticks, held(inChest, 'stick'))
  const n = Math.max(0, Math.min(ingots, have, Math.floor(Number(budget))))
  if (ingots > 0 && n <= 0) return { takes: [], why: have > 0 ? `the town keeps its last ${TOWN_IRON_RESERVE} ingots` : 'holds no iron_ingot', ironHeld: have, reserve: have > 0 }
  if (ingots > 0 && sticks - st > sticksMakeable) return { takes: [], why: `${sticks - st} stick(s) short and the bag's wood makes ${sticksMakeable}`, noSticks: true }
  const takes = []
  if (n > 0) takes.push({ name: 'iron_ingot', count: n })
  if (st > 0) takes.push({ name: 'stick', count: st })
  return { takes, why: takes.length ? null : 'holds nothing the kit draws', ironHeld: have }
}

/** The draw left after a take -> { ingots, sticks }. Pure. */
export const kitLeftAfter = (left = {}, took = {}) => ({
  ingots: Math.max(0, (Number(left.ingots) || 0) - (Number(took?.iron_ingot) || 0)),
  sticks: Math.max(0, (Number(left.sticks) || 0) - (Number(took?.stick) || 0)),
})

/** Is the multi-container rule in force for this town now? -> bool. Pure: the switch, and the index read (townIronSpare). */
export const kitMultiOn = (spare, on = TOOLKIT_MULTI.on) => !!on && spare != null

/** Does the town index rule this draw out (the order's gate, multi on)? The town's spare is short of the draw. Pure. */
export const kitTownShort = (spare, ingots) => spare != null && (Number(ingots) || 0) > 0 && spare.spare < (Number(ingots) || 0)

// ---- THE KIT'S TOWN SEARCH (toolkit-03; owner 10-19 ~12:15Z "yes do that") -------------------------------------------
// MEASURED 10-19 (ES 24 h; read-only RCON census 12:05Z): 521 kit runs ended no_iron and 156 crafted, while the town chests
// held 2,343 ingots -- 2,201 in town containers, and EVERY town has 2-11 containers holding a kit's 4 + TOWN_IRON_KEEP. The
// draw looked in at most 3 containers nearest HOME (withdrawSweep; a walled-in or lidded double chest spent two of them), and
// the nearest kit-sized holder is the 1st-11th nearest home (median 7th): towns where it is within the first 4 ended no_iron
// 44 times over 7 towns, towns where it is 7th or later 475 times over 9. Now the draw searches the way withdraw_pick does
// (townsearch-01/02, withdrawpick.mjs townSearchOrder over skills.mjs townSearchView): EVERY town container, never twice in
// one run, nearest the bot first (the stock journal does not count iron: no group), a container that held too little iron
// is a `kit_iron` miss for SEARCH_MISS_TTL_MS (no deposit since) so the next run continues with the rest, and a visit that
// could not look inside leaves this bot's search for SEARCH_FAIL_SKIP_MS. The order's gate is the SAME rule (townSearchEmpty).

/**
 * THE MISS IS PER DRAW SIZE (Codex r1 P5): "held too little iron" depends on how much this bot draws -- 4 for the whole kit
 * (8 held), 3 for the axe (7), 1 for the shovel (5), less with a credit. The need name for a draw of n ingots: `kit_iron` for
 * the whole kit's 4 (the name the base wrote, so its misses keep their meaning), `kit_iron_<n>` below it. Pure.
 */
// ironpick-01: the sizes run to kitMaxIngots (7 with the pickaxe: 3 + 3 + 1); 4 keeps the base's name, every other size its own
export const kitIronNeed = (n, max = kitMaxIngots()) => {
  const k = Math.max(1, Math.min(max, Math.floor(Number(n) || 4)))
  return k === 4 ? KIT_IRON_NEED : `${KIT_IRON_NEED}_${k}`
}
/** A container seen holding `have` ingots is a miss for every draw size it cannot give with the keep: n + keep > have. Pure. */
export const kitIronMissNeeds = (have = 0, keep = TOWN_IRON_KEEP, max = kitMaxIngots()) =>
  Array.from({ length: max }, (_, i) => i + 1).filter(n => n + keep > (Number(have) || 0)).map(n => kitIronNeed(n, max))
/** Can a container's lack of sticks stop this draw? Only when the iron is drawn and the bag's wood cannot make the sticks. */
export const kitSticksAtRisk = (draw = {}, sticksMakeable = Infinity) => (Number(draw.ingots) || 0) > 0 && (Number(draw.sticks) || 0) > sticksMakeable
/** A container that had the iron but not the sticks (and the bag could not make them) leaves THIS bot's kit search this long
 *  -- while the bag still cannot make them -- so a stickless bot does not spend every run on the same holders. */
export const KIT_NO_STICKS_SKIP_MS = 60 * 60 * 1000   // a miss's own life (SEARCH_MISS_TTL_MS): longer than a failed run's cooldown + backoff

/** Containers one run may open for the draw (each visit ~1 s on Paper inside a town; the clock is the real bound). */
export const KIT_SEARCH_VISITS = 12
/** The draw starts no visit inside this much of the skill's clock: the crafts (a table walk, two `craft` runs) keep it. */
export const KIT_CRAFT_RESERVE_MS = 60_000
/** A visit's result that moved nothing and says nothing about the town's iron -> the search moves on to the next container
 *  (withdrawpick SEARCH_FAIL_SKIP plus the stock claim the journal could not confirm). */
export const KIT_VISIT_NEXT = Object.freeze(new Set(['chest_unreachable', 'container_blocked', 'stock_unconfirmed']))
/** Failures that are not "the town has none": no backoff beyond the cooldown (the next run continues the search -- only
 *  when this run made progress: kitSearchEnd says `stalled`, which backs off, when it did not). */
export const KIT_NO_BACKOFF = Object.freeze(new Set(['kit_search_more']))
/** ...and at most this many `more` runs in a row (Claude r1 P2): deposits end misses and misses expire, so a large or busy
 *  town could hand every run new candidates; the next `more` after these backs off like any failure. */
export const KIT_MORE_MAX = 3

/**
 * WHAT ONE VISIT OF THE KIT'S SEARCH MEANS -> 'took' | 'next' | 'skip' | 'miss' | 'stop'. Pure over withdrawVisit's return.
 *   took  the draw was taken (verified)
 *   next  the visit could not look inside, or the journal refused the claim: nothing learned, the next container
 *   skip  looked inside, the container has what is wanted but the draw cannot be made here (no sticks and no wood to make
 *         them; no room in the chest for the room-making stacks): NOT a miss of the town's iron, the next container
 *   miss  looked inside, too little of what is wanted: remembered (the town's memory), the next container
 *   stop  anything else (the bag, the window, an unsettled transfer): the run ends on it, as it always did
 */
export function kitVisitStep (v = {}) {
  const r = v?.result
  if (r?.status === 'success') return 'took'
  if (r) return KIT_VISIT_NEXT.has(r.failClass) ? 'next' : 'stop'
  return v?.skip ? 'skip' : 'miss'
}

/**
 * THE RUN'S ANSWER WHEN NO CONTAINER GAVE THE DRAW -> { outcome, failClass }. Pure.
 *   left        candidates the town search still has (townSearchOrder, after this run's visits)
 *   noSticks    a container held the iron but neither it nor the bag's wood had the sticks (this run, or one this bot's
 *               search still skips for it)
 *   progressed  this run learned something the next one uses: a miss recorded, or a container left out (a visit that could
 *               not look inside, or one that lacked only the sticks)
 *   coverage    the town scan saw every town container (townCobbleScan: not cut at its cap, every column loaded)
 * Candidates left is never "no iron": `more`, with no backoff, the next run continues -- only when this run progressed
 * (Codex r1 P1), else `stalled`, which backs off. An exhausted search over a town not wholly seen is `unseen`, never no_iron
 * (Codex r1 P2). Only an exhausted search of the whole town says no_iron (or no_sticks, which names a remedy).
 */
export function kitSearchEnd ({ left = 0, noSticks = false, progressed = true, coverage = true } = {}) {
  if (Number(left) > 0) return progressed ? { outcome: 'more', failClass: 'kit_search_more' } : { outcome: 'stalled', failClass: 'kit_search_stalled' }
  if (noSticks) return { outcome: 'no_sticks', failClass: 'kit_no_sticks' }
  if (!coverage) return { outcome: 'unseen', failClass: 'kit_search_unseen' }
  return { outcome: 'no_iron', failClass: 'kit_no_iron' }
}

/** THE `_kit_search` ROW's detail (one per kit run whose draw searched; its duration spans the search's walks) -> <= 300.
 *  outcome is the run's (crafted, no_iron, more, aborted, ...); the counters as in the `_toolkit` row; tried= last. Pure. */
export const kitSearchRow = ({ outcome = '-', need = '-', town = '-', cand = '-', visits = 0, vfail = 0, maxrep = 0, left = '-', tried = [] } = {}) =>
  `outcome=${outcome} need=${need} town=${town} cand=${cand} visits=${visits} vfail=${vfail} maxrep=${maxrep} left=${left} tried=[${(tried ?? []).join(';')}]`.slice(0, 300)

/** The `_toolkit_search_mode` licence row (once per spawn): a kind the baseline cannot write. */
export const kitSearchModeDetail = () =>
  `phase=mode search=town need=${KIT_IRON_NEED} order=unknown,nearest visits=${KIT_SEARCH_VISITS} craft_reserve_s=${KIT_CRAFT_RESERVE_MS / 1000} no_backoff=${[...KIT_NO_BACKOFF].join('+')} multi=${TOOLKIT_MULTI.on ? 1 : 0} town_reserve=${TOWN_IRON_RESERVE}`

const lazy = v => (typeof v === 'function' ? v() : v)
/** The runner declined to start it: nothing is charged (recount.mjs DECLINED). */
const DECLINED = RUNNER_DECLINED   // the one shared set (declined.mjs, homefix-01)

/**
 * THE ORDER -> { order, state }. Pure; cognitive.mjs supplies the readings and keeps `state`. AFTER every other
 * deterministic order (the milestone's work order, the town deposit, the recount, wear_out, the town and well orders,
 * pruning and the room order): a ready milestone step is never displaced, and a full bag's remedies go first.
 *   on, atTown                 the switch; the bot is in town (never a trip)
 *   items                      the bag
 *   credit                     ingots a failed kit run drew and kept (kitDraw)
 *   container  () -> bool      a town container is in reach of the town's scan
 *   townMiss   () -> bool      every town container recently held too little iron (complete coverage)
 *   room       (draw) -> bool  the bag can take the draw (withdrawpick roomPlan, the same keep as at the chest)
 *   tableNear  () -> bool      a crafting table within the craft skill's 32-block search (kitMeans)
 *   state      { lastIssuedAt, backoffUntil }
 */
/**
 * THE PREFIX SIZES A KIT ORDER MAY TRY, largest first -> [n, ...]. Pure (ironpick-01, Claude r1 P2). The whole kit first; with
 * TOOLKIT_IRONPICK on, when the town is known short of that draw (no container holds it + TOWN_IRON_KEEP) or the bag has no
 * room for it, the next smaller prefix in kit order -- the pickaxe first -- down to one tool: a town drawn down to 7-10 ingots
 * per container still gives the pickaxe (3 + 4), where the whole kit (7 + 4) would give nothing at all. Off: the whole kit
 * only (the base rule exactly).
 */
// ONLY A DRAW THAT MAKES THE PICKAXE narrows: an axe-and-shovel run keeps the base's whole-kit rule exactly (one variable)
export const kitPrefixes = (needs = [], { ironpick = TOOLKIT_IRONPICK.on } = {}) =>
  (ironpick && needs[0] === 'iron_pickaxe' ? Array.from({ length: needs.length }, (_, i) => needs.length - i) : (needs.length ? [needs.length] : []))
/** A whole-town no_iron for the run's draw that a SMALLER prefix may still meet: `narrow`, no backoff (the next order takes the
 *  prefix), capped with `more` by KIT_MORE_MAX. Its failClass: */
export const KIT_NARROW = 'kit_search_narrow'
/**
 * DOES THIS RUN END `narrow`? -> bool. Pure. Only a pickaxe draw of more than one tool, with TOOLKIT_IRONPICK on, whose search
 * ended no_iron or no_sticks (Codex r2 P2: a whole-kit stick shortage must not hide a pickaxe-only draw the town can give),
 * while the pickaxe's own prefix is still meetable (`prefixMet`: its draw needs no iron -- the credit covers it, Claude r2 P3 --
 * or the town search still has a candidate for it).
 */
export const kitNarrows = ({ on = TOOLKIT_IRONPICK.on, needs = [], outcome = '', prefixMet = false } = {}) =>
  !!on && needs[0] === 'iron_pickaxe' && needs.length > 1 && (outcome === 'no_iron' || outcome === 'no_sticks') && !!prefixMet
/**
 * IS A HOLDER THAT LACKED THE STICKS STILL HELD BACK FOR THIS DRAW? -> bool. Pure (Codex r2 P2). `had`: the sticks it held
 * when it was skipped (null: not recorded -- held, the base rule). Held while what it had plus what the bag's wood makes is
 * short of this draw's sticks: a holder skipped for the whole kit's 8 is not held back from the pickaxe's 4.
 */
// ONLY A PICKAXE DRAW with the switch on (Codex r3 P2: one variable) -- any other draw keeps the base's unconditional hold-back
export const kitStickHeld = (had, draw = {}, sticksMakeable = 0, { ironpick = TOOLKIT_IRONPICK.on } = {}) =>
  !(ironpick && (draw.needs ?? [])[0] === 'iron_pickaxe') ||
  had == null || !Number.isFinite(Number(had)) || Number(had) + (Number(sticksMakeable) || 0) < (Number(draw.sticks) || 0)

export function toolkitOrder ({ now = 0, on = TOOLKIT.on, ironpick = TOOLKIT_IRONPICK.on, atTown = false, items = [], credit = 0, container = false, townMiss = false,
                                room = true, tableNear = false, state = {} } = {}) {
  const s = { ...state }
  const none = () => ({ order: null, state: s })
  if (!on || !atTown) return none()
  const full = kitDraw(items, { credit, ironpick })
  if (!full.needs.length) return none()
  if (now - (s.lastIssuedAt ?? -Infinity) < TOOLKIT_COOLDOWN_MS || now < (s.backoffUntil ?? 0)) return none()
  if (!lazy(container)) return none()
  // townMiss(d): the town search would find no container for THIS draw's size (the whole kit, or a prefix)
  const missFor = dk => (typeof townMiss === 'function' ? townMiss(dk) : townMiss)
  // ironpick-01: room for the tools too, even when the credit covers the draw (Claude r1 P3: the credit-only run made tools
  // into a bag never checked); off: the base condition exactly
  const roomFor = dk => {
    // A PICKAXE RUN THE CREDIT FUNDS may visit no chest at all -- none when it needs no sticks, none that gives anything when the
    // town has no sticks -- so room a deposit could make is no room for it (Codex r2 P2, r3 P2): the bag's EXISTING empty slots
    // must take every tool it makes, and a slot for the sticks it would take
    if (ironpick && dk.needs.includes('iron_pickaxe') && dk.ingots === 0) return BAG_SLOTS - list(items).length >= dk.needs.length + (dk.sticks > 0 ? 1 : 0)
    return !((dk.ingots > 0 || dk.sticks > 0) && typeof room === 'function' && !room(dk))
  }
  let d = null, tabled = false
  for (const k of kitPrefixes(full.needs, { ironpick })) {
    const dk = k === full.needs.length ? full : kitDraw(items, { credit, ironpick, limit: k })
    if (dk.ingots > 0 && missFor(dk)) continue
    // THE TABLE: carried or 4 planks' worth of wood (from the bag), else near (the craft's 32-block search, asked LAST: a world
    // scan on a decision that may decline -- Claude r1 P3-3) -- else the craft cannot run (any prefix alike)
    if (!tabled) { if (!kitMeans(items).tableOk && !lazy(tableNear)) return none(); tabled = true }
    if (!roomFor(dk)) continue
    d = dk; break
  }
  if (!d) return none()
  s.lastIssuedAt = now
  const label = n => (n === 'iron_pickaxe' ? `iron_pickaxe above ${IRONPICK_TRIP_USES} uses` : n)
  // `n` (a prefix of the kit, only when it is one) rides in args: skill.args is `flattened` in the mapping (no new field)
  return { order: { skill: 'toolkit', args: { credit: Math.max(0, Number(credit) || 0), ...(d.needs.length < full.needs.length ? { n: d.needs.length } : {}) },
                    why: `at town with no usable ${d.needs.map(label).join(' or ')}: the town's iron makes ${d.needs.length > 1 ? 'them' : 'it'} (${d.ingots} ingot(s) drawn${d.sticks ? `, ${d.sticks} stick(s)` : ''})` }, state: s }
}

/**
 * DOES withdraw_pick STEP ASIDE FOR THE KIT'S IRON PICKAXE? -> bool. Pure (ironpick-01: no double trip). `pickNeed` is the
 * withdraw order's own need (skills.mjs pickNeedOf: 'pick' = no usable pickaxe, 'trippick' = none at the trip line, null = no
 * need); `items` the bag both orders read; `kitOrder` is toolkitOrder's answer NOW, as a dry run (its state not kept): every gate -- the switch, the town, the
 * cooldown and backoff, the town's iron not ruled out, the table, the room for the draw AND the tools. When that order would
 * be issued and makes an iron pickaxe, withdraw_pick does not also fetch a stone copy for the same need: the kit's order
 * comes later in the same chain (after the well, prune and room orders), on this decision or the next. Whenever the kit could
 * NOT issue it (on cooldown, backed off after no_iron, no room, no table, TOOLKIT=off or TOOLKIT_IRONPICK=off), withdraw_pick
 * runs exactly as before -- the chain never has both orders refusing the same bag.
 */
export const withdrawDefersToKit = (pickNeed, kitOrder, items = [], { ironpick = TOOLKIT_IRONPICK.on } = {}) =>
  pickNeed != null && kitOrder?.skill === 'toolkit' && kitNeeds(items, { ironpick }).includes('iron_pickaxe')

/** The `_toolkit_ironpick_mode` licence row (once per spawn): a kind the base cannot write. */
export const ironpickModeDetail = (m = TOOLKIT_IRONPICK, kit = TOOLKIT) =>
  `phase=mode on=${m.on && kit.on ? 1 : 0} mode=${m.mode} toolkit=${kit.on ? 1 : 0} trip_uses=${IRONPICK_TRIP_USES} kit=${KIT_NAMES.filter(n => m.on || n !== 'iron_pickaxe').join('+')} max_ingots=${kitMaxIngots(m.on)}${m.note ? ` note=${m.note.replace(/\s+/g, '_')}` : ''}`

/** `name@uses` of the bag's best iron-or-better pickaxe (most uses), or '-'. Pure. */
export const bestIronPickTag = (items = []) => {
  const p = list(items).filter(it => isPickaxe(it.name) && tier(it.name) >= IRON_TIER).sort((a, b) => remaining(b) - remaining(a))[0]
  return p ? `${p.name}@${Number.isFinite(remaining(p)) ? remaining(p) : 'full'}` : '-'
}
/**
 * THE `kit_ironpick` CHANGE ROW's detail (one per kit run whose needs included the iron pickaxe; written at the run's end,
 * duration = the run) -> <= 300. outcome as the `_toolkit` row's; made 1|0 (the run's verified crafts include the iron
 * pickaxe); best= the best iron-or-better pickaxe before and after; drew= ingots this run drew; iron_seen= what the container
 * it drew from held when opened, -1 when nothing was drawn (the read's town-keep gate: iron_seen - drew >= keep); keep=
 * TOWN_IRON_KEEP; slots= the bag's used slots at the end. Pure.
 */
export const ironpickRow = ({ outcome = '-', made = 0, bestBefore = '-', bestAfter = '-', drew = 0, ironSeen = -1, keep = TOWN_IRON_KEEP, slots = -1 } = {}) =>
  `outcome=${outcome} made=${made ? 1 : 0} best=${bestBefore}->${bestAfter} drew=${drew} iron_seen=${ironSeen} keep=${keep} slots=${slots}`.slice(0, 300)

/** After the order ran -> the new state. A skip or an interruption costs nothing; a failure backs off. Pure. */
export function toolkitOutcome (status, now = 0, state = {}, failClass = null) {
  const s = { ...state }
  if (DECLINED.has(failClass)) { s.lastIssuedAt = -Infinity; return s }   // refunded: the runner never started it
  // a search cut by its budget with candidates left (kitSearchEnd `more`) is no answer about the town: only the cooldown --
  // up to KIT_MORE_MAX in a row, then it backs off too (and the streak starts over)
  if (failClass === KIT_NARROW) failClass = 'kit_search_more'   // ironpick-01: `narrow` is a `more` for the backoff and its cap
  const more = status === 'failed' && KIT_NO_BACKOFF.has(failClass)
  s.moreStreak = more ? (s.moreStreak ?? 0) + 1 : 0
  if (status === 'failed' && (!more || s.moreStreak > KIT_MORE_MAX)) { s.backoffUntil = now + TOOLKIT_BACKOFF_MS; if (more) s.moreStreak = 0 }
  else if (status === 'success') s.backoffUntil = 0
  return s
}

/** The credit after a run: what it drew less what its crafts consumed, never below 0 and never above the bag's ingots. */
export const creditAfter = (credit = 0, drewIngots = 0, usedIngots = 0, bagIngots = Infinity) =>
  Math.max(0, Math.min(bagIngots, (Number(credit) || 0) + (Number(drewIngots) || 0) - (Number(usedIngots) || 0)))

/** `name@uses,...` for every pickaxe/axe/shovel in a bag (the row's before/after; the read re-derives every gate from it). */
export const toolsTag = (items = []) => list(items).filter(it => /_(pickaxe|axe|shovel)$/.test(it.name))
  .map(it => `${it.name}@${Number.isFinite(remaining(it)) ? remaining(it) : 'full'}`).sort().join(',') || '-'

/**
 * THE `_toolkit` ROW's structured args (skill.args is `flattened` in the mapping, and a 300-char detail can cut the tool
 * tags): every gate field, the bag's tools before and after whole. The read takes these first, the detail only as a
 * fallback. Pure.
 */
export function toolkitArgs ({ phase = 'kit', outcome = 'nothing', needs = [], drew = 0, sticks = 0, used = 0, crafted = [], creditIn = 0, creditOut = 0,
                               stop = '-', before = '-', after = '-', listed = 0, worn = 0, search = null } = {}) {
  return phase === 'wear'
    ? { phase, outcome, listed, worn, stop: String(stop).slice(0, 120), before, after }
    : { phase, outcome, needs: needs.join('+') || '-', drew, sticks, used, crafted: crafted.join('+') || '-', credit_in: creditIn, credit_out: creditOut,
        ...(search ? { search_need: search.need ?? '-', search_town: search.town ?? -1, search_cand: search.cand ?? -1, search_visits: search.visits ?? 0,
                       search_vfail: search.vfail ?? 0, search_maxrep: search.maxrep ?? 0, search_left: search.left ?? -1 } : {}),
        stop: String(stop).slice(0, 120), before, after }
}

/**
 * THE `_toolkit` ROW's detail -> string <= 300. key=value, the outcome and the gate fields first (logEvent cuts at 300).
 *   phase     kit | wear
 *   outcome   crafted | partial | no_iron | no_sticks | more (search cut, candidates left) | short | room | craft_failed | draw_failed |
 *             nothing | error | aborted | (wear) done | none
 *   town cand visits vfail maxrep left: the kit search (toolkit-03) -- containers in the town view, candidates when the draw
 *             began, visits made, visits that could not look inside, most visits to one container (must be 1), candidates left
 *   drew      server-verified ingots taken this run; sticks likewise
 *   used      ingots the verified crafts consumed (3 per axe, 1 per shovel)
 *   crafted   names made, verified as a NEW usable copy in the bag
 *   credit    ingots carried into and out of the run
 *   before / after: toolsTag of the bag
 */
export function toolkitRow ({ phase = 'kit', outcome = 'nothing', needs = [], drew = 0, sticks = 0, used = 0, crafted = [], creditIn = 0, creditOut = 0,
                              stop = '-', before = '-', after = '-', listed = 0, worn = 0, tried = [], search = null, multi = 0, parts = 0 } = {}) {
  const clean = v => String(v ?? '-').replace(/\s+/g, '_').slice(0, 60)
  // THE SEARCH'S COUNTERS (toolkit-03) right after the gate fields, before anything the 300-character cut can reach (the
  // townsearch row's lesson: tried= alone is cut, so a read of it is blind past a few visits)
  const sr = search ? ` town=${search.town ?? '-'} cand=${search.cand ?? '-'} visits=${search.visits ?? 0} vfail=${search.vfail ?? 0} maxrep=${search.maxrep ?? 0} left=${search.left ?? '-'}` : ''
  const head = phase === 'wear'
    ? `phase=wear outcome=${outcome} listed=${listed} worn=${worn}`
    : `phase=kit outcome=${outcome} needs=${needs.join('+') || '-'} drew=${drew} sticks=${sticks} used=${used} crafted=${crafted.join('+') || '-'} credit=${creditIn}->${creditOut}${multi ? ` parts=${parts}` : ''}${sr}`
  return `${head} stop=${clean(stop)} before=${before} after=${after} tried=[${tried.join(';')}]`.slice(0, 300)
}
