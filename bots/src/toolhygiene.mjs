// TOOL HYGIENE, PART 1: NO REDUNDANT CRAFTS (owner, 2026-10-07; docs/reports/toolhygiene-design-2026-10-07.md).
//
// MEASURED 10-07 00:00-17:30Z (80 bots, 69,879 decisions): 4,606 `craft stone_pickaxe` proposals and 218 crafted
// against 13 iron pickaxes; 257 of those proposals came from bots already holding a stone-or-better pickaxe with 40+
// uses, and 132 of 245 wooden proposals from bots holding a wooden-or-better copy above 10 uses. GITM's planner rule
// ("items in the inventory are used directly and never obtained again", arXiv 2305.17144) applied at admission.
//
// THE RULE IS IMPLIED BY THE LADDER'S OWN SATISFACTION TEST, never stricter (CLAUDE.md: two correct guards meeting
// where the bot has no legal move). The stone rung counts a stone pickaxe only with >= MIN_TRIP_USES (milestones.mjs
// capCount), and 3,123 of the day's 4,606 stone proposals came from bots whose best copy had 11-39 uses under that
// rung: refusing at "> 10 uses" would refuse the active rung's own work order every decision. So a stone craft is
// redundant only beside a stone-or-better copy with >= MIN_TRIP_USES, any other pickaxe beside a same-or-better copy
// above FLOOR (withdrawpick.mjs usableTool), and NOTHING the current task or prerequisite wants is ever refused.
//
// Pure. Never touches the bot.
import { FLOOR, HARD_STOP, ESCAPE_RESERVE, remaining, TOOL_HYGIENE } from './toolfor.mjs'
import { MIN_TRIP_USES } from './oretunnel.mjs'
import { descentPickNeed, pickaxeUses } from './exit-contract.mjs'

/** Harvest rank, as skills.mjs equivalentTools ranks a tool: golden harvests what wooden does. */
export const HARVEST_RANK = Object.freeze({ wooden: 1, golden: 1, stone: 2, iron: 3, diamond: 4, netherite: 5 })
const PICK_RE = /^(wooden|golden|stone|iron|diamond|netherite)_pickaxe$/
export const pickRank = name => { const m = PICK_RE.exec(String(name ?? '')); return m ? HARVEST_RANK[m[1]] : null }
/** The pickaxes the escape's two-pickaxe ask names (reflex.mjs pickaxePrereq items; a test holds them equal): the usable
 *  count is taken over these, so a refusal implies that ask would read satisfied whether or not it was adopted. */
export const ESCAPE_PICK_NAMES = Object.freeze(new Set(['wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'diamond_pickaxe']))
/** Stations a bot needs one of: a carried one is placed by the skill that uses it (craft, smelt). */
export const STATIONS = Object.freeze(new Set(['crafting_table', 'furnace']))

/** Uses a held copy needs before a craft of `item` is redundant: the ladder's own line for stone, else above FLOOR. */
export function craftCoverNeed (item) {
  return item === 'stone_pickaxe' ? Math.max(FLOOR + 1, MIN_TRIP_USES) : FLOOR + 1
}

/** Does the current task (its wanted set: the milestone or prerequisite target, family and ingredients) want it? */
const taskWants = (wanted, item) => !!wanted && (wanted instanceof Set ? wanted.has(item) : Array.isArray(wanted) && wanted.includes(item))

/**
 * redundantCraft(item, items, { wanted, on, y }) -> null (admit) | { item, kind, held, uses, need, detail, pickUses, exitNeed }
 *   items   the bag (mineflayer Item[]: name, count, maxDurability, durabilityUsed)
 *   wanted  the admission gate's wanted set for the active task (cognitive #wantedItems); an item in it is never
 *           refused -- the task is unsatisfied by its own test, so making it is progress, not redundancy.
 *   on      the switch (TOOL_HYGIENE); off never refuses.
 *   ESCAPE  a PICKAXE craft is never refused while the bag holds fewer than ESCAPE_RESERVE (2) usable pickaxes: the
 *           escape reflex will not dig stone with the last one and asks for two (reflex.mjs ESCAPE_PICKAXES_NEEDED;
 *           Claude review, round 1 -- an entombed bot holding one stone@52 was the dead end).
 *   y       the bot's feet: a PICKAXE craft is never refused while the bag holds fewer swings (exit-contract
 *           pickaxeUses, summed over every pickaxe) than a descent from here keeps in reserve (descentPickNeed) --
 *           `mine` refuses below that line and its remedy is another pickaxe (Codex review, round 1).
 * The copy named is the fullest covering one; it does everything another copy would (dig with it).
 */
export function redundantCraft (item, items = [], { wanted = null, on = TOOL_HYGIENE.on, y = null, exitShort = null, now = Date.now() } = {}) {
  if (!on || typeof item !== 'string' || taskWants(wanted, item)) return null
  const bag = (Array.isArray(items) ? items : []).filter(it => it?.name && (it.count ?? 1) > 0)
  if (STATIONS.has(item)) {
    const n = bag.filter(it => it.name === item).reduce((s, it) => s + (it.count ?? 1), 0)
    if (n < 1) return null
    const how = item === 'furnace'
      ? 'smelt places a carried furnace by itself (or: place item=furnace)'
      : 'craft uses a carried crafting_table by itself (or: place item=crafting_table)'
    return { item, kind: 'station', held: item, uses: null, need: 1, pickUses: null, exitNeed: null, detail: `you already carry ${n === 1 ? 'a' : n} ${item} -- ${how}; no second one is needed` }
  }
  const rank = pickRank(item)
  if (rank == null) return null
  const usable = bag.filter(it => ESCAPE_PICK_NAMES.has(it.name) && remaining(it) > HARD_STOP).reduce((s, it) => s + (it.count ?? 1), 0)
  if (usable < ESCAPE_RESERVE) return null
  const pickUses = pickaxeUses(bag)
  const exitNeed = Number.isFinite(y) ? descentPickNeed(y) : null
  if (exitNeed != null && pickUses < exitNeed) return null
  // ...and the shortfall `mine` last refused for, wherever the bot is NOW: its remedy says "run surface first", and at the
  // surface descentPickNeed is 2 (Claude round 2: refused at y=16, then refused the craft at y=64 -- a loop).
  if (exitShortOpen(exitShort, pickUses, now)) return null
  const need = craftCoverNeed(item)
  // STONE AND WOODEN ARE COVERED ONLY BY STONE/WOODEN/GOLDEN (Claude round 2): an iron copy as cover refused the stone
  // craft for a bot whose stone copies were worn, and toolFor then dug stone with the iron -- 146 iron uses over 150
  // stone digs in the probe, the burn iron retention removed. Iron and better are covered by the same rank or higher.
  const cover = bag.filter(it => { const r = pickRank(it.name); return r != null && r >= rank && (rank >= 3 || r <= 2) && remaining(it) >= need })
    .sort((a, b) => (remaining(b) - remaining(a)) || (pickRank(b.name) - pickRank(a.name)))[0]
  if (!cover) return null
  const left = remaining(cover)
  const usesText = Number.isFinite(left) ? `${left} uses left` : 'unknown durability (counted as full)'
  const tierWord = item.replace(/_pickaxe$/, '')
  return {
    item, kind: 'pickaxe', held: cover.name, uses: Number.isFinite(left) ? left : null, need, pickUses, exitNeed,
    detail: `you already hold a ${cover.name} with ${usesText} (a ${tierWord}-or-better pickaxe with ${need}+ uses is all any goal asks for) -- dig with it; craft another ${item} when it is below ${need}`,
  }
}

/** How long a `mine` refusal for want of pickaxe swings keeps pickaxe crafts admitted (cognitive PREREQ_TTL_MS). */
export const EXIT_SHORT_TTL_MS = 15 * 60_000
/** Record `mine`'s exit-contract refusal for want of pickaxe swings on the bot (skills.mjs calls it). */
export function noteExitShort (bot, exit) {
  if (bot && exit && !exit.ok && exit.reason === 'pickaxe' && Number.isFinite(exit.want)) bot.exitPickShort = { want: exit.want, at: Date.now() }
}
/** Is a recorded shortfall still open: fresh, and the bag still below the swings it asked for? Pure. */
export function exitShortOpen (s, pickUses, now = Date.now()) {
  return !!s && Number.isFinite(s.want) && Number.isFinite(s.at) && now - s.at < EXIT_SHORT_TTL_MS && pickUses < s.want
}

/** The `_redundant_craft` row: a readable detail and the same facts as structured `args` (logger.mjs: flattened,
 *  never truncated) -- scripts/host/toolhygieneread.py re-derives G2/G4 from args plus the row's own snapshot. */
export function redundantRow (v, { taskId = null, wanted = false, source = 'model', wantedSet = null } = {}) {
  const held = `${v.held}:${v.uses ?? (v.kind === 'station' ? 'carried' : 'full')}`
  return {
    detail: `item=${v.item} held=${held} need=${v.need} kind=${v.kind} task=${taskId ?? '-'} wanted=${wanted ? 1 : 0} source=${source} pick_uses=${v.pickUses ?? '-'} exit_need=${v.exitNeed ?? '-'}`,
    args: { item: v.item, held: v.held, uses: v.uses ?? null, need: v.need, kind: v.kind, task: taskId ?? null,
            wanted: wanted ? 1 : 0, source, pick_uses: v.pickUses ?? null, exit_need: v.exitNeed ?? null, wants: wantsList(wantedSet) },
  }
}
/** The task's whole wanted set, '|'-joined and sorted: the read judges G1/G4 against it independently of `wanted`. */
export const wantsList = w => (w instanceof Set ? [...w] : Array.isArray(w) ? w : []).filter(x => typeof x === 'string').sort().join('|')
/** Items whose admitted crafts write a `_craft_admit` row (the read's G1 population). */
export const HYGIENE_ITEMS = Object.freeze(new Set(['wooden_pickaxe', 'golden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'diamond_pickaxe', 'netherite_pickaxe', 'crafting_table', 'furnace']))
/** The `_craft_admit` row: an ADMITTED craft of a hygiene item, with the task's wanted set (the one input the read cannot
 *  see in the snapshot). The snapshot beside it is the bag the gate judged. */
export function admitRow (item, { taskId = null, source = 'model', wantedSet = null, count = 1 } = {}) {
  return { detail: `item=${item} count=${count} task=${taskId ?? '-'} source=${source}`,
           args: { item, count: Number(count) || 1, task: taskId ?? null, source, wants: wantsList(wantedSet) } }
}
