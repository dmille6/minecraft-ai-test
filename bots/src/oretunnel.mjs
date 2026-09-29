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
import { cellLavaSafe } from './lavaguard.mjs'
import { Vec3 } from 'vec3'
const { goals, Movements } = pkg

export const IRON_KINDS = ['iron_ore', 'deepslate_iron_ore']
/** One number for the ladder AND the trip (both reviews): a stone pickaxe with fewer uses cannot pay a median tunnel. */
export const MIN_TRIP_USES = 40
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
