// THE ORE TUNNEL: reach iron the bot already knows about, safely, with a pickaxe that can pay for the trip.
//
// WHY (2026-09-29, both engines, docs/reports/iron-research-2026-09-29.md). Paper anti-xray is OFF on all 16
// worlds, so a bot KNOWS every ore block in its loaded chunks -- the nearest iron is a median 15 blocks away.
// Humans search (caves, mountains, strip mines) because they cannot see through stone; our bots do not need to.
// What failed was REACHING it: gather only considers air-exposed ore (skills.mjs isExposed), and when every
// candidate was buried it escalated to `mine({y})`, which stairs toward DRYNESS, not toward the ore -- ~1.7% of
// escalations did anything useful. This is Baritone's MineProcess idea (a costed path to a known ore position;
// not novel) with this fleet's safety rules, pickaxe budget and exit guarantees.
//
// THE CONFIGURATION IS PROBED, NOT ASSUMED (Claude's design review ran mineflayer-pathfinder 2.4.5 on a fake
// 1.21.8 world):
//   - maxDropDown 1 allows NO descent (movements.js measures from the landing floor): every buried ore returned
//     noPath. maxDropDown 2 enables getMoveDown, which digs a 1x1 SHAFT (a 7-deep hole whose way back needed 15
//     breaks). maxDropDown 2 + getMoveDown disabled + infiniteLiquidDropdownDistance false cuts a STAIRCASE
//     whose way back needs 0-3 breaks. No towers, no parkour, no scaffold.
//   - A failed search still returns its best PARTIAL path: only status === 'success' is a plan.
//   - reachGoal's isEnd is eye distance only, so it "reaches" ore through stone; GoalGetToBlock (face-adjacent)
//     leaves the ore exposed and its drop in pickup range. The composite picks the cheapest; the walk then uses
//     the ONE winning goal, so a re-plan cannot switch targets.
//   - searchRadius is a COST cap, not a distance: 40 refused a 10-deep staircase (cost 77); 400 matches the
//     existing APPROACH_SLACK. A heuristic weight of 5 took a 10-deep search from 1.4-1.85 s to ~0.2 s.
//   - The break veto goes through safeToBreak for every pathfinder break; the ORE and cluster digs happen outside
//     the pathfinder, so the executor runs the same veto on them (the "lava under the ore" fixture planned a
//     clean path ending beside an ore sitting on lava).
//   - Water is TERRAIN (owner rule): the step veto is lava/fire/climbables only; water appears only in the
//     BREAK veto, which stops the tunnel from OPENING liquid into itself.
import pkg from 'mineflayer-pathfinder'
import { remaining, HARD_STOP, tier } from './toolfor.mjs'
import { cellLavaSafe, dropLavaSafe } from './lavaguard.mjs'
import { Vec3 } from 'vec3'
const { goals, Movements } = pkg

export const IRON_KINDS = ['iron_ore', 'deepslate_iron_ore']
/** One number for the ladder AND the trip (both reviews): a stone pickaxe with fewer uses cannot pay a median tunnel. */
export const MIN_TRIP_USES = 40
// One fresh stone_pickaxe's spare uses (131 - HARD_STOP). A trip that needs more is refused as too long rather than as
// pickaxe_short: the remedy "craft a stone_pickaxe" must be one that, once done, lets the same request pass.
export const ONE_PICK_USES = 131 - HARD_STOP
/** Pickaxe uses kept for the walk back: the measured reverse path needs 0-3 breaks. */
export const RETURN_RESERVE = 5
export const CLUSTER_CAP = 9
export const CANDIDATE_RADIUS = 24
export const MAX_CANDIDATES = 8
export const PLAN_TIMEOUT_MS = 3000
export const SEARCH_SLACK = 400
export const HEURISTIC_WEIGHT = 5
/** mine's own rule (skills.mjs "NO DIGGING AT HOME"): the base floor is not a resource. The tunnel obeys it too --
 *  the sandbox's first run showed it would not otherwise (mine refused within 2 blocks of home; the tunnel dug). */
export const HOME_RADIUS = 12
export const nearHome = (p, home) => !!(home && p && Math.hypot(p.x + 0.5 - home.x, p.z + 0.5 - home.z) <= HOME_RADIUS)

const F6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
const LIQUID = /^(water|lava|bubble_column|kelp|kelp_plant|seagrass|tall_seagrass)$/
const FALLING = /^(sand|red_sand|gravel|suspicious_sand|suspicious_gravel|[a-z_]+_concrete_powder|anvil|chipped_anvil|damaged_anvil|pointed_dripstone)$/
const HOT = /^(lava|fire|soul_fire|magma_block|campfire|soul_campfire)$/
const CLIMBABLE = /^(ladder|vine|scaffolding|weeping_vines|weeping_vines_plant|twisting_vines|twisting_vines_plant|cave_vines|cave_vines_plant)$/
const waterlogged = b => { try { return b?.getProperties?.()?.waterlogged === true } catch { return false } }

/**
 * May this block be BROKEN? 0 = yes, 100 = veto (the pathfinder treats >= 100 as unsafe, movements.js:273).
 * Vetoes: no position (unloaded), any of the SIX faces unknown / liquid / waterlogged (dontCreateFlow checks five
 * and misses unloaded neighbours and waterlogged blocks), or a falling block above. Never throws.
 */
export function breakHazard (blockAt, block) {
  try {
    const p = block?.position
    if (!p) return 100
    for (const [dx, dy, dz] of F6) {
      const n = blockAt(p.offset(dx, dy, dz))
      if (!n || n.name == null) return 100
      if (LIQUID.test(n.name) || waterlogged(n)) return 100
    }
    if (FALLING.test(blockAt(p.offset(0, 1, 0))?.name ?? '')) return 100
    return 0
  } catch { return 100 }
}

/**
 * May the bot STAND here? The SAME rule index.mjs's lava corridor guard applies to every planned leg
 * (lavaguard.mjs corridorSafe: cellLavaSafe over the 3x3 around each sample). The sandbox's lava fixture planned a
 * tunnel the corridor guard then refused mid-walk -- two correct guards composing into a dead end (CLAUDE.md) --
 * so the planner now refuses exactly what the guard would. Plus climbables (one-way in the planner). WATER IS
 * TERRAIN: it is not vetoed here.
 */
export function stepHazard (blockAt, block) {
  try {
    const p = block?.position
    if (!p) return 100
    if (HOT.test(block.name ?? '') || CLIMBABLE.test(block.name ?? '')) return 100
    // A REAL Vec3: mineflayer's blockAt -> prismarine-world getBlock calls pos.floored(). A plain object threw on
    // every cell, the catch turned each throw into a veto, and every tunnel on the sandbox became noPath in 1 ms.
    const at = (x, y, z) => blockAt(new Vec3(x, y, z))
    for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      if (!cellLavaSafe(at, p.x + dx, p.y, p.z + dz).safe) return 100
    }
    // THE SAME TEST THE CORRIDOR GUARD RUNS (index.mjs path_update -> lavaguard corridorSafe): it also scans the drop
    // under every sample, lava beside included. A route this planner accepted and that guard refuses clears the goal
    // mid-walk -- two correct guards meeting in a dead end (Claude review of e455cf5).
    if (!dropLavaSafe(at, p.x, p.y, p.z).safe) return 100
    return 0
  } catch { return 100 }
}

const isPick = it => /_pickaxe$/.test(it?.name ?? '')
const spare = it => Math.max(0, (Number.isFinite(remaining(it)) ? remaining(it) : 10_000) - HARD_STOP)
/** A stone-or-better pickaxe with at least `min` uses: the capability the iron rung and the trip both require. */
export function hasTripPickaxe (items = [], min = MIN_TRIP_USES) {
  return (items || []).some(it => isPick(it) && (it.count ?? 1) > 0 && tier(it.name) >= tier('stone_pickaxe') && remaining(it) >= min)
}

/**
 * pickBudget(items, { pickBreaks, cluster }) -> { ok, haveAll, haveOre, need, why }
 * Travel digs spend the cheapest tier first, so every pickaxe's spare uses count toward them; the ore itself needs
 * stone or better. Both must hold, with RETURN_RESERVE kept for the walk back.
 */
export function pickBudget (items = [], { pickBreaks = 0, cluster = 1, reserve = RETURN_RESERVE } = {}) {
  const picks = (items || []).filter(isPick)
  const haveAll = picks.reduce((n, it) => n + spare(it), 0)
  const haveOre = picks.filter(it => tier(it.name) >= tier('stone_pickaxe')).reduce((n, it) => n + spare(it), 0)
  const need = pickBreaks + cluster + reserve
  if (haveOre < cluster + reserve) return { ok: false, haveAll, haveOre, need, why: `stone-or-better pickaxe uses ${haveOre} < ${cluster} ore + ${reserve} reserve` }
  if (haveAll < need) return { ok: false, haveAll, haveOre, need, why: `pickaxe uses ${haveAll} < ${pickBreaks} tunnel + ${cluster} ore + ${reserve} reserve` }
  return { ok: true, haveAll, haveOre, need, why: null }
}

/**
 * THE TRIP DECISION, pure, so the refusal CHAIN is testable (CLAUDE.md: test the chain, not the single guard).
 *   too_long       the trip needs more than one fresh stone pickaxe holds: no pickaxe the bot can craft fixes it.
 *   pickaxe_short  refuse with a remedy -- a pickaxe with minUses uses -- that, once held, makes this same call ok.
 */
export function tripDecision (items = [], { pickBreaks = 0, cluster = 1, reserve = RETURN_RESERVE } = {}) {
  const budget = pickBudget(items, { pickBreaks, cluster, reserve })
  if (budget.need > ONE_PICK_USES) return { ...budget, ok: false, refuse: 'too_long' }
  if (!budget.ok) return { ...budget, refuse: 'pickaxe_short', minUses: budget.need + HARD_STOP }
  return { ...budget, refuse: null }
}

// ---- ROOM BY CAPACITY ---------------------------------------------------------------------------------------------
// The old rule was `emptySlotCount() < 2 -> refuse, deposit first`. On oretunnel-03 (10-02) that refused 9 of 12
// tunnels; the 3 that ran all reached the ore. The refused bots had 0 empty slots but 176-252 items of spare room in
// stone stacks they already held, and "deposit first" names a remedy the bot often cannot perform: the bank chests
// are full (CLAUDE.md: a refusal must name a remedy executable from where the bot is).
//
// CAPACITY IS PER ITEM (both reviews of 3b17b30): spare in an andesite stack cannot hold cobblestone, and a drop only
// merges into a plain stack of the SAME item (a renamed or enchanted stack is a different item). The ore's slot is
// reserved explicitly. The pre-plan screen is cheap and lenient; the authoritative check runs AFTER planning, on the
// most the planned breaks can drop, with RETURN_RESERVE slack for digs the plan does not list.
/** Pre-plan screen only: one stone type needs this much spare, or a free slot beyond the ore's. Each break yields at
 *  most one stone item; the canary's tunnels were 3-27 blocks (oretunnel-03, 10-02). */
export const STONE_ROOM = 32
export const ORE_DROP = 'raw_iron'
/** What the tunnel's own breaks drop, for the screen: stone, deepslate, dirt/grass, gravel, andesite, diorite, granite,
 *  tuff (registry 1.21.x; pinned in the test). */
export const STONE_DROPS = new Set(['cobblestone', 'cobbled_deepslate', 'dirt', 'gravel', 'andesite', 'diorite', 'granite', 'tuff'])
/** Vanilla maxima without Fortune where minecraft-data's blockLoot (1.21.11) lists less: it gives lapis 1-2, redstone
 *  1, copper 1-2. Vanilla: lapis 4-9, redstone 4-5, raw_copper 2-5, nether_gold_ore 2-6 nuggets, clay 4 balls,
 *  glowstone 2-4 dust. The larger of the two is used, so a wrong entry can only over-reserve. */
export const VANILLA_MAX = { lapis_lazuli: 9, redstone: 5, raw_copper: 5, gold_nugget: 6, clay_ball: 4, glowstone_dust: 4 }

const json = v => JSON.stringify(v ?? null)
const list = v => (Array.isArray(v) ? v : [])
/** A stack a fresh block drop can merge into: no NBT, no added components, no removed components. */
export const plainStack = it => !!it && (it.nbt == null) && list(it.components).length === 0 && list(it.removedComponents).length === 0
const spareFor = (items, name) => (items || []).reduce((n, it) =>
  n + (it?.name === name && plainStack(it) && Number.isFinite(it.stackSize) && Number.isFinite(it.count) ? Math.max(0, it.stackSize - it.count) : 0), 0)

/**
 * lootFor(registry) -> blockName -> [{ item, max }]. Every item the block can drop when NOT mined with Silk Touch
 * (silk-only entries are skipped: enchanted tools are refused or kept out of the tunnel), each at its maximum count.
 * Falls back to the registry's plain drop list (max 1); air and unknown blocks drop nothing.
 */
export function lootFor (registry) {
  return name => {
    if (!name || /^(air|cave_air|void_air)$/.test(name)) return []
    const by = new Map()
    const entries = registry?.blockLoot?.[name]?.drops
    if (Array.isArray(entries) && entries.length) {
      for (const e of entries) {
        if (e?.silkTouch || !e?.item) continue
        const hi = Number(e.stackSizeRange?.[1] ?? e.stackSizeRange?.[0] ?? 1) || 1
        by.set(e.item, Math.max(by.get(e.item) ?? 0, Math.max(hi, VANILLA_MAX[e.item] ?? 0)))
      }
    } else {
      for (const d of registry?.blocksByName?.[name]?.drops ?? []) {
        const id = (d && typeof d === 'object') ? (d.drop?.id ?? d.drop ?? d.id) : d
        const item = registry?.items?.[id]?.name
        if (item) by.set(item, Math.max(by.get(item) ?? 0, VANILLA_MAX[item] ?? 1))
      }
    }
    return [...by].map(([item, max]) => ({ item, max }))
  }
}

/** tunnelDrops(blockNames, lootOf) -> Map(item -> most it can yield). Every item a block can drop counts at its max. */
export function tunnelDrops (blockNames = [], lootOf = () => []) {
  const need = new Map()
  for (const b of blockNames) for (const { item, max } of lootOf(b) ?? []) need.set(item, (need.get(item) ?? 0) + max)
  return need
}

/**
 * tunnelNeeds(breaks, cluster, lootOf, { isOre }) -> { need, ore, oreBlocks }
 *   breaks / cluster: [{ pos, name }]. ORE is the UNION of the target cluster and every iron block the route itself
 *   breaks (a separate vein crossed on the way down), each position once, at its max raw_iron. Everything else the
 *   route breaks goes into `need`, per item, at its max (tunnelDrops).
 */
export function tunnelNeeds (breaks = [], cluster = [], lootOf = () => [], { isOre = n => IRON_KINDS.includes(n) } = {}) {
  const key = p => `${p.x},${p.y},${p.z}`
  const ores = new Map()
  for (const c of cluster) if (c?.pos) ores.set(key(c.pos), c.name)
  for (const b of breaks) if (isOre(b?.name)) ores.set(key(b.pos), b.name)
  let ore = 0
  for (const name of ores.values()) ore += Math.max(1, ...(lootOf(name) ?? []).filter(d => d.item === ORE_DROP).map(d => d.max))
  const need = tunnelDrops(breaks.filter(b => !isOre(b?.name)).map(b => b?.name), lootOf)
  return { need, ore, oreBlocks: ores.size }
}

/**
 * unplannedDigFits(drops, ctx) -> { ok, why }. May the walk dig a block the plan did NOT list (a re-plan's detour, a
 * re-centre, a stall)? Conservative by design (Codex pass 4): its drop may use only spare in stacks of the SAME item
 * beyond that item's planned need + slack, and beyond what earlier unplanned digs in this tunnel already took --
 * NEVER an empty slot: those belong to the planned drops and to every ore slot the plan needs. Both must hold:
 *   ledger: spare at the walk's START - planned total - slack - unplanned already allowed (covers drops that have
 *           not landed yet: a dig resolves before its item is picked up)
 *   now:    spare NOW - planned still undug - slack (covers anything else that filled the stack meanwhile)
 * ctx: { start, live (items), plannedTotal, remaining, spent (Maps item -> count), slack, emptySlots }.
 * raw_iron is an item like any other here: the ore's planned total sits in plannedTotal.
 */
export function unplannedDigFits (drops = [], { start = [], live = [], plannedTotal = new Map(), remaining = new Map(),
                                                spent = new Map(), slack = 0, emptySlots = 0 } = {}) {
  const emptyUsable = 0   // never: every empty slot is reserved (emptySlots is accepted only so this stays explicit)
  for (const { item, max } of drops ?? []) {
    const planned = plannedTotal.get(item) ?? 0
    const used = spent.get(item) ?? 0
    const ledger = spareFor(start, item) - planned - slack - used + emptyUsable
    const now = spareFor(live, item) - (remaining.get(item) ?? 0) - slack + emptyUsable
    if (Math.min(ledger, now) < max) {
      return { ok: false, why: `no room for ${item} (spare beyond planned ${planned} + reserve ${slack}` +
                               `${used ? ` + ${used} already dug` : ''} is ${Math.min(ledger, now)} < ${max}; ${emptySlots} empty kept for planned drops)` }
    }
  }
  return { ok: true, why: null }
}

/**
 * toolRisk(item, enchantName) -> null | why. A digging tool with Fortune (more drops than counted) or Silk Touch (stone
 * stays stone, grass stays grass: items nothing was counted for). An enchantment this cannot NAME, or a read that
 * throws, is a risk too (fail closed). enchantName maps a registry id to its name.
 */
export function toolRisk (item, enchantName = () => null) {
  if (!/_(pickaxe|shovel|axe|hoe)$/.test(item?.name ?? '')) return null
  let raw
  try { raw = item.enchants } catch { return `${item.name}: enchantments unreadable` }
  if (raw == null) return null
  const entries = Array.isArray(raw) ? raw : (Array.isArray(raw?.enchantments) ? raw.enchantments : null)
  if (!entries) return `${item.name}: enchantments unreadable`
  for (const e of entries) {
    let n = typeof e?.name === 'string' ? e.name : null
    if (n == null) { try { n = enchantName(e?.id) } catch { n = null } }
    if (typeof n !== 'string' || !n) return `${item.name}: unidentified enchantment ${json(e?.id ?? e)}`
    n = n.replace(/^minecraft:/, '')
    if (n === 'fortune' || n === 'silk_touch') return `${item.name}: ${n}`
  }
  return null
}

/**
 * tunnelRoom(items, emptySlots, { cluster, need, slack, stackSizeOf }) ->
 *   { ok, slotsNeeded, slotsShort, emptySlots, oreSpare, short: [{ item, need, spare, slots }], why }
 *   ORE: `cluster` raw_iron (+ slack after planning) fits in held plain raw_iron stacks, else it takes empty slots
 *     (reserved first). After planning, `cluster` is tunnelNeeds' ore: the target cluster AND iron along the route.
 *   AFTER PLANNING (`need` = tunnelDrops of the plan): each item must fit need + slack in its OWN held plain stacks,
 *     or it takes ceil(overflow / stackSize) empty slots of its own.
 *   BEFORE PLANNING (`need` null): one stone type with >= STONE_ROOM spare, else one more empty slot.
 * Stack sizes come from the items (else stackSizeOf); an unknown size counts as 1 per slot, never 64 assumed.
 */
export function tunnelRoom (items = [], emptySlots = 0, { cluster = CLUSTER_CAP, need = null, slack = 0, stackSizeOf = null } = {}) {
  const empty = Math.max(0, Math.floor(Number(emptySlots) || 0))
  const sizeOf = name => (items || []).find(it => it?.name === name && Number.isFinite(it.stackSize))?.stackSize ?? stackSizeOf?.(name) ?? 1
  const oreSpare = spareFor(items, ORE_DROP)
  const oreNeed = cluster + (need ? slack : 0)
  const oreSlots = oreSpare >= oreNeed ? 0 : Math.ceil((oreNeed - oreSpare) / Math.max(1, sizeOf(ORE_DROP)))
  const short = []
  let stoneSlots = 0
  if (need) {
    for (const [item, n] of need) {
      if (item === ORE_DROP) continue
      const spare = spareFor(items, item)
      if (spare >= n + slack) continue
      const slots = Math.ceil((n + slack - spare) / Math.max(1, sizeOf(item)))
      stoneSlots += slots
      short.push({ item, need: n, slack, spare, slots })
    }
  } else {
    const best = Math.max(0, ...[...STONE_DROPS].map(d => spareFor(items, d)))
    if (best < STONE_ROOM) { stoneSlots = 1; short.push({ item: 'stone', need: STONE_ROOM, slack: 0, spare: best, slots: 1 }) }
  }
  const slotsNeeded = oreSlots + stoneSlots
  const slotsShort = Math.max(0, slotsNeeded - empty)
  const parts = []
  if (oreSlots) parts.push(`ore: ${oreNeed} ${ORE_DROP} need a slot (held ${ORE_DROP} spare ${oreSpare})`)
  for (const s of short) parts.push(`${s.item}: need ${s.need}${s.slack ? `+${s.slack}` : ''}, spare ${s.spare} -> ${s.slots} slot${s.slots === 1 ? '' : 's'}`)
  return { ok: slotsShort === 0, slotsNeeded, slotsShort, emptySlots: empty, oreSpare, short,
           why: slotsShort ? `${parts.join('; ')}; ${empty} empty` : null }
}

/** What fills the bag, for the refusal: the item names taking the most slots. */
export function bagOccupants (items = [], n = 3) {
  const by = new Map()
  for (const it of items || []) {
    if (!it?.name) continue
    const e = by.get(it.name) ?? { name: it.name, count: 0, slots: 0 }
    e.count += it.count ?? 0; e.slots++; by.set(it.name, e)
  }
  return [...by.values()].sort((a, b) => b.slots - a.slots || b.count - a.count).slice(0, n)
}

/** Candidates ranked by estimated cost, not straight-line distance: depth below the feet costs ~2.4 breaks a block. */
export function rankCandidates (feet, positions = [], max = MAX_CANDIDATES) {
  const cost = p => Math.hypot(p.x - feet.x, p.z - feet.z) + 2.4 * Math.max(0, Math.floor(feet.y) - p.y) + 1.5 * Math.max(0, p.y - Math.floor(feet.y) - 1)
  return positions.slice().sort((a, b) => cost(a) - cost(b)).slice(0, max)
}

/** The connected iron around a start block (26-neighbour flood fill), nearest first, at most `cap`. */
export function clusterOf (blockAt, start, kinds = IRON_KINDS, cap = CLUSTER_CAP) {
  const want = new Set(kinds)
  const key = p => `${p.x},${p.y},${p.z}`
  const seen = new Set([key(start)]), out = [], queue = [start]
  while (queue.length && out.length < cap) {
    const p = queue.shift()
    const b = blockAt(p)
    if (!b || !want.has(b.name)) continue
    out.push(p)
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      if (!dx && !dy && !dz) continue
      const q = p.offset(dx, dy, dz)
      if (!seen.has(key(q))) { seen.add(key(q)); queue.push(q) }
    }
  }
  return out
}

/**
 * The tunnel's movement profile: a clone of `base` (the gather profile index.mjs builds) with the probed
 * configuration above. NEW arrays for the exclusions -- index.mjs shares exclusionAreasStep by reference across
 * every profile, so pushing into it would change them all.
 */
export function tunnelMovements (bot, base = null, { home = null } = {}) {
  const m = base ? Object.assign(Object.create(Object.getPrototypeOf(base)), base) : new Movements(bot)
  m.canDig = true
  m.allowParkour = false
  m.allow1by1towers = false
  m.allowSprinting = false
  m.scafoldingBlocks = []
  m.maxDropDown = 2
  m.infiniteLiquidDropdownDistance = false
  m.dontCreateFlow = true
  m.dontMineUnderFallingBlock = true
  m.getMoveDown = () => {}          // no 1x1 shafts: a staircase can be walked back out
  // NO DIAGONALS IN A 1-WIDE TUNNEL. A diagonal step has to clip past two corner blocks; the planner allows it and
  // the body snags. On the sandbox, walks that stalled had drifted sideways and stayed stuck through three
  // re-centrings; cardinal-only staircases are straight lines the bot's 0.6-wide box always fits.
  m.getMoveDiagonal = () => {}
  const at = p => bot.blockAt(p)
  m.exclusionAreasStep = [...(base?.exclusionAreasStep ?? []), b => stepHazard(at, b)]
  m.exclusionAreasBreak = [...(base?.exclusionAreasBreak ?? []), b => (nearHome(b?.position, home) ? 100 : breakHazard(at, b))]
  return m
}

/**
 * BESIDE OR BELOW THE ORE, NEVER ON TOP OF IT. GoalGetToBlock's isEnd accepts the cell above the block (dy = +1);
 * on the sandbox every stance that ended ON the ore hung its dig for the full 20 s timeout (two runs), while every
 * stance beside or below dug cleanly -- and digging the block you stand on also removes your own support.
 */
export class SideOfBlock extends goals.GoalGetToBlock {
  isEnd (node) { return super.isEnd(node) && !(node.x === this.x && node.z === this.z && node.y === this.y + 1) }
}

/** GoalCompositeAny with a weighted heuristic: an admissible-enough speed-up measured at <= 12% worse paths. */
export class WeightedAny extends goals.GoalCompositeAny {
  heuristic (n) { return HEURISTIC_WEIGHT * super.heuristic(n) }
}

/**
 * planTunnel(bot, { candidates, moves }) -> { ok, target, goal, path, breaks, ms, minY } | { ok: false, why, ms }
 * One search to the cheapest candidate (face-adjacent goals). Pumped asynchronously so the bot's event loop keeps
 * running between search slices. Only status === 'success' is a plan.
 */
export async function planTunnel (bot, { candidates = [], moves, timeoutMs = PLAN_TIMEOUT_MS,
                                         yieldFn = () => new Promise(r => setImmediate(r)) } = {}) {
  const t0 = Date.now()
  if (!candidates.length) return { ok: false, why: 'no candidates', ms: 0 }
  const subgoals = candidates.map(p => new SideOfBlock(p.x, p.y, p.z))
  let result = null
  try {
    const gen = bot.pathfinder.getPathFromTo(moves, bot.entity.position, new WeightedAny(subgoals),
      { timeout: timeoutMs, searchRadius: SEARCH_SLACK, optimizePath: false })
    for (;;) {
      const nx = gen.next()
      if (nx.done) break
      result = nx.value?.result ?? result
      if (!result || result.status !== 'partial' || Date.now() - t0 > timeoutMs) break
      await yieldFn()
    }
  } catch (e) {
    return { ok: false, why: `search threw: ${String(e?.message ?? e).slice(0, 40)}`, ms: Date.now() - t0 }
  }
  const ms = Date.now() - t0
  if (!result || result.status !== 'success') return { ok: false, why: `no route (${result?.status ?? 'none'})`, ms }
  const path = result.path ?? []
  const end = path.at(-1)
  const idx = end ? subgoals.findIndex(g => g.isEnd(end)) : -1
  if (idx < 0) return { ok: false, why: 'route ends at no candidate', ms }
  const seen = new Set(), breaks = []
  for (const n of path) for (const b of (n.toBreak ?? [])) {
    const k = `${b.x},${b.y},${b.z}`
    if (!seen.has(k)) { seen.add(k); breaks.push(b) }
  }
  // THE WALK RE-PLANS ON EVERY BLOCK UPDATE (its own digs), so it must use the same weighted heuristic as the plan:
  // unweighted re-plans in solid stone took 1.4-1.85 s each (design review probe), and on the sandbox two walks
  // stalled at the same depth until the stuck reflex cancelled them.
  return { ok: true, target: candidates[idx], goal: new WeightedAny([subgoals[idx]]), path, breaks, ms,
           minY: Math.min(...path.map(n => Math.floor(n.y))) }
}
