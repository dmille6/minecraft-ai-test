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

/** TOOLKIT=on|off, default on; anything else reads as on and the process says so in its `_toolkit` mode row. */
export function toolkitMode (env = {}) {
  const raw = env?.TOOLKIT
  if (raw == null || String(raw).trim() === '') return { on: true, mode: 'on', note: 'TOOLKIT unset' }
  const v = String(raw).trim().toLowerCase()
  if (v === 'on' || v === 'off') return { on: v === 'on', mode: v, note: null }
  return { on: true, mode: 'on', note: `TOOLKIT=${String(raw).slice(0, 20)} unreadable, using on` }
}
export const TOOLKIT = Object.freeze(toolkitMode(typeof process !== 'undefined' ? process.env : {}))

const usable = it => !!it?.name && remaining(it) > FLOOR
const list = items => (Array.isArray(items) ? items : []).filter(it => it?.name)
const IRON_TIER = tier('iron_pickaxe')

/** A usable pickaxe of iron tier or better (iron, diamond, netherite) in the bag. */
export const ironPickHeld = items => list(items).some(it => isPickaxe(it.name) && tier(it.name) >= IRON_TIER && usable(it))

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

/** The kit, in craft order: ingots and sticks per tool (1.21 recipes: axe 3 ingots + 2 sticks, shovel 1 + 2). */
export const KIT = Object.freeze({ iron_axe: Object.freeze({ ingots: 3, sticks: 2 }), iron_shovel: Object.freeze({ ingots: 1, sticks: 2 }) })
export const KIT_NAMES = Object.freeze(Object.keys(KIT))
/** Sticks the bag keeps after the kit: the stone-pickaxe recipe's two (bankable.mjs RESERVE_RECIPE). */
export const STICK_KEEP = 2
/** Ingots a town container KEEPS after a kit draw: a container is drawn from only when it holds the draw + this. */
export const TOWN_IRON_KEEP = 4
/** The town memory's need name for "this container held too little iron for a kit" (withdrawpick's ingredient-miss map). */
export const KIT_IRON_NEED = 'kit_iron'
export const TOOLKIT_COOLDOWN_MS = 10 * 60 * 1000
export const TOOLKIT_BACKOFF_MS = 30 * 60 * 1000

const held = (items, name) => list(items).reduce((n, it) => n + (it.name === name ? (it.count ?? 0) : 0), 0)

/** The kit tools this bag has no USABLE copy of (a spent copy is a consumable toolfor uses up first: not "held"). */
export const kitNeeds = (items = []) => KIT_NAMES.filter(n => !list(items).some(it => it.name === n && usable(it)))

/**
 * WHAT THE KIT MUST DRAW FROM TOWN -> { ingots, sticks, needs }. Pure.
 *   ingots  the recipes' ingots less `credit` (ingots an earlier kit run drew and no craft consumed): never the bag's own
 *           iron -- that is the ladder's (bucket, the next iron pickaxe), and towndeposit keeps every ingot for it.
 *   sticks  enough that the bag still holds STICK_KEEP after the crafts.
 */
export function kitDraw (items = [], { credit = 0 } = {}) {
  const needs = kitNeeds(items)
  const want = needs.reduce((t, n) => t + KIT[n].ingots, 0)
  const c = Math.max(0, Math.min(Number(credit) || 0, held(items, 'iron_ingot'), want))
  const sticksNeed = needs.reduce((t, n) => t + KIT[n].sticks, 0)
  return { needs, ingots: want - c, sticks: needs.length ? Math.max(0, sticksNeed + STICK_KEEP - held(items, 'stick')) : 0 }
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
  // NO IRON FOR A CRAFT THAT CANNOT FINISH: the sticks this container cannot give must be makeable from the bag's wood
  if (ingots > 0 && sticks - st > sticksMakeable) return { takes: [], why: `${sticks - st} stick(s) short and the bag's wood makes ${sticksMakeable}`, noSticks: true }
  const takes = []
  if (ingots > 0) {
    const have = held(inChest, 'iron_ingot')
    if (have < ingots + keep) return { takes: [], why: `holds ${have} iron_ingot, a kit draw needs ${ingots} + ${keep} kept` }
    takes.push({ name: 'iron_ingot', count: ingots })
  }
  if (st > 0) takes.push({ name: 'stick', count: st })
  return { takes, why: takes.length ? null : 'holds nothing the kit draws' }
}

const lazy = v => (typeof v === 'function' ? v() : v)
/** The runner declined to start it: nothing is charged (recount.mjs DECLINED). */
const DECLINED = new Set(['runner_paused', 'runner_busy', 'body_held'])

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
export function toolkitOrder ({ now = 0, on = TOOLKIT.on, atTown = false, items = [], credit = 0, container = false, townMiss = false,
                                room = true, tableNear = false, state = {} } = {}) {
  const s = { ...state }
  const none = () => ({ order: null, state: s })
  if (!on || !atTown) return none()
  const d = kitDraw(items, { credit })
  if (!d.needs.length) return none()
  if (now - (s.lastIssuedAt ?? -Infinity) < TOOLKIT_COOLDOWN_MS || now < (s.backoffUntil ?? 0)) return none()
  // THE TABLE: near (the craft's 32-block search), carried, or 4 planks' worth of wood to make one -- else the craft cannot run
  if (!kitMeans(items, { tableNear: lazy(tableNear) }).tableOk) return none()
  if (!lazy(container)) return none()
  if (d.ingots > 0 && lazy(townMiss)) return none()
  if ((d.ingots > 0 || d.sticks > 0) && typeof room === 'function' && !room(d)) return none()
  s.lastIssuedAt = now
  return { order: { skill: 'toolkit', args: { credit: Math.max(0, Number(credit) || 0) },
                    why: `at town with no usable ${d.needs.join(' or ')}: the town's iron makes ${d.needs.length > 1 ? 'them' : 'it'} (${d.ingots} ingot(s) drawn${d.sticks ? `, ${d.sticks} stick(s)` : ''})` }, state: s }
}

/** After the order ran -> the new state. A skip or an interruption costs nothing; a failure backs off. Pure. */
export function toolkitOutcome (status, now = 0, state = {}, failClass = null) {
  const s = { ...state }
  if (DECLINED.has(failClass)) { s.lastIssuedAt = -Infinity; return s }   // refunded: the runner never started it
  if (status === 'failed') s.backoffUntil = now + TOOLKIT_BACKOFF_MS
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
                               stop = '-', before = '-', after = '-', listed = 0, worn = 0 } = {}) {
  return phase === 'wear'
    ? { phase, outcome, listed, worn, stop: String(stop).slice(0, 120), before, after }
    : { phase, outcome, needs: needs.join('+') || '-', drew, sticks, used, crafted: crafted.join('+') || '-', credit_in: creditIn, credit_out: creditOut,
        stop: String(stop).slice(0, 120), before, after }
}

/**
 * THE `_toolkit` ROW's detail -> string <= 300. key=value, the outcome and the gate fields first (logEvent cuts at 300).
 *   phase     kit | wear
 *   outcome   crafted | partial | no_iron | short | room | craft_failed | nothing | error | aborted | (wear) done | none
 *   drew      server-verified ingots taken this run; sticks likewise
 *   used      ingots the verified crafts consumed (3 per axe, 1 per shovel)
 *   crafted   names made, verified as a NEW usable copy in the bag
 *   credit    ingots carried into and out of the run
 *   before / after: toolsTag of the bag
 */
export function toolkitRow ({ phase = 'kit', outcome = 'nothing', needs = [], drew = 0, sticks = 0, used = 0, crafted = [], creditIn = 0, creditOut = 0,
                              stop = '-', before = '-', after = '-', listed = 0, worn = 0, tried = [] } = {}) {
  const clean = v => String(v ?? '-').replace(/\s+/g, '_').slice(0, 60)
  const head = phase === 'wear'
    ? `phase=wear outcome=${outcome} listed=${listed} worn=${worn}`
    : `phase=kit outcome=${outcome} needs=${needs.join('+') || '-'} drew=${drew} sticks=${sticks} used=${used} crafted=${crafted.join('+') || '-'} credit=${creditIn}->${creditOut}`
  return `${head} stop=${clean(stop)} before=${before} after=${after} tried=[${tried.join(';')}]`.slice(0, 300)
}
