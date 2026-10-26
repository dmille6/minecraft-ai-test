// LIDPLACE-01: THE PATHFINDER'S SCAFFOLD NEVER CHOOSES A TOWN CHEST'S LID OR A PLAN CELL WHEN ANY OTHER CELL WILL DO.
// Pure: no bot, no world reads -- index.mjs hands in the plan's cell set and a state-id test for the cell below.
//
// WHY (diagnosed 10-26): moves.exclusionAreasPlace held only the protected-zone price, so a pillar-up or bridge block (dirt,
// cobble) could land on a container's lid or in a town-plan cell. The showcase: Gale towered for spruce_log (10-25 19:06Z)
// on top of found-01's store chest at -9,71,-2 -- dirt at -9,72 and -9,73 -- and tripwire G3 stopped every bot for 18 h.
// Fleet: `_lid_clear outcome=dug` 37 in 7 d across 16 pools (~5 lids a day covered by bot-placed dirt/cobble). Breaking a
// plan cell is already priced (townplan.mjs planBreakCost); placing was not.
//
// A PRICE, NEVER A VETO. mineflayer-pathfinder 2.4.5 sums every exclusion function into the move's cost and drops the move
// once the cost passes 100 (movements.js, every `if (cost > 100) return`). A veto here is the composition trap the working
// rules name: a bot standing ON a chest at the bottom of a pit has the tower as its one way up. LID_PLACE_COST is arithmetic:
//   - one priced placement per move, except getMoveJumpUp, which may place D and C (two prices);
//   - getMoveJumpUp also pays exclusionStep three times in safeOrBreak (A, H, B), and the death-site step price is 16
//     (deathsites.mjs DEATH_SITE_STEP_COST): 2 move + 2 x 1 placeCost + 2 x 10 + 3 x 16 = 72 <= 100, ~28 left for digs;
//   - getMoveUp (the 1x1 tower): 1 + 1 + 10 + one step price; getMoveForward (a bridge): 1 + 1 + 10 + three step prices.
//   So inside a death disc every priced move survives. What a price CAN still do (townground.mjs's lesson): a move the base
//   already prices within 10 of 100 (a jump-up digging three hard blocks inside a death disc) AND that places on a lid is
//   dropped. That is the only deletion, and the bot keeps every unpriced move. Against a 1-per-block walk, 10 prefers any
//   detour under ~10 blocks -- in town, stepping off the chest to tower beside it costs 1-2.

// WHICH CELL THE PATHFINDER ASKS ABOUT. The README says the function is handed "the Block the bot is planning to place a block
// inside", and getMoveUp and getMoveJumpUp do that. getMoveForward in 2.4.5 passes blockC -- the cell ABOVE its placement D
// (lib/movements.js `cost += this.exclusionPlace(blockC)` before `toPlace.push({ ..., y: node.y - 1, ... })`); upstream fixed
// it in PrismarineJS/mineflayer-pathfinder#351 (merged 2025-08-18, unreleased: npm's latest is still 2.4.5). So the cell
// asked about is judged at dy 0 AND dy -1: correct on 2.4.5 and on a release with #351. The cost of the second look is a
// few cells over-priced (a tower's second block above a plan cell), never a missed lid.
//
// WHAT IS GUARDED (placeGuardCells + the lid test):
//   - every placed or reserved plan cell (planFurnitureCells' cells -- the break price's data) and its stand, feet and head
//     (keepouts' NEVER tier: a block there makes the furniture unreachable, G3's "unreachable")
//   - the cell above a placed or reserved plan CHEST cell (a reserved site's lid, before the chest exists)
//   - the cell above ANY chest-like block the bot's world shows (isLidded below): a town chest, a found chest, a bank chest.
//     Barrels, furnaces and crafting tables open under anything (lidrule.mjs; vanilla), so a block on them shuts nothing.
//
// NOT HERE: the reflex and skill pillars that call bot.placeBlock directly (reflex.mjs air/scaffold/entombment, skills.mjs
// ride-floor-down) never consult the pathfinder's arrays. Survival places where it must (protectzone's rule too).

/** LIDPLACE=0 -> no price anywhere: the profile is exactly the base's (the rollback without a deploy). */
export const lidPlaceOn = (env = process.env) => String(env?.LIDPLACE ?? '1') !== '0'

/** The price of one guarded placement. See the arithmetic above: never a veto. */
export const LID_PLACE_COST = 10
/** Blocks whose lid a solid block above keeps shut (vanilla ChestBlock / EnderChestBlock; a shulker opens upward). */
export const LIDDED_RE = /^(chest|trapped_chest|ender_chest|(?:[a-z_]+_)?shulker_box)$/
const LID_KINDS = /^(chest|trapped_chest)$/
const k3 = (x, y, z) => `${x},${y},${z}`

/**
 * THE PLAN'S PLACE GUARD -> Set of 'x,y,z'. Pure. For every placed or reserved cell or station of every plot: its cell, its
 * stand (feet and head), and for a chest cell the cell above it.
 */
export function placeGuardCells (plan) {
  const out = new Set()
  for (const pl of plan?.plots ?? []) {
    for (const c of [...(pl.cells ?? []), ...(pl.stations ?? [])]) {
      if (!(c?.state === 'placed' || c?.state === 'reserved') || !Array.isArray(c.at)) continue
      const [x, y, z] = c.at
      out.add(k3(x, y, z))
      if (LID_KINDS.test(String(c.kind ?? ''))) out.add(k3(x, y + 1, z))
      if (Array.isArray(c.stand)) { out.add(k3(c.stand[0], c.stand[1], c.stand[2])); out.add(k3(c.stand[0], c.stand[1] + 1, c.stand[2])) }
    }
  }
  return out
}

/** Is the cell (x, y, z) one a placement must avoid? guard = placeGuardCells' set (or null); lidded(x, y, z) = is a lidded
 *  container standing there. Pure. */
const guarded = (guard, lidded, x, y, z) => !!(guard && guard.size && guard.has(k3(x, y, z))) || !!(lidded && lidded(x, y - 1, z))

/**
 * THE PLACE PRICE -> 0 | LID_PLACE_COST for the cell the pathfinder asks about (`pos`). Pure over its inputs: the plan's
 * guard set and a `lidded(x, y, z)` test. The placed cell is `pos` or the cell under it (getMoveForward 2.4.5, see above).
 * One price per call however many reasons hold: the arithmetic above counts placements, not reasons.
 */
export function townPlaceCost (guard, lidded, pos) {
  if (!pos) return 0
  const x = pos.x, y = pos.y, z = pos.z
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return 0
  return guarded(guard, lidded, x, y, z) || guarded(guard, lidded, x, y - 1, z) ? LID_PLACE_COST : 0
}

/** The state ids of every lidded container in a registry -> Set<number>. Pure over the registry. */
export function liddedStateIds (registry) {
  const out = new Set()
  for (const b of registry?.blocksArray ?? Object.values(registry?.blocks ?? {})) {
    if (!b || !LIDDED_RE.test(b.name ?? '')) continue
    const lo = b.minStateId ?? b.defaultState, hi = b.maxStateId ?? b.defaultState
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) continue
    for (let s = lo; s <= hi; s++) out.add(s)
  }
  return out
}

/**
 * THE exclusionAreasPlace ENTRY index.mjs installs -> (block) => 0 | LID_PLACE_COST. `stateIdAt(x, y, z)` is the world's
 * state id there (0 when unloaded: no lid); `guard()` returns the plan's current guard set or null. `on` false -> always 0.
 * Built once; per call it is at most two Set lookups and two state-id reads (no Block object, no allocation but the key).
 */
export function makeLidPlacePrice ({ registry, stateIdAt, guard = () => null, on = true }) {
  const ids = liddedStateIds(registry)
  const lidded = (x, y, z) => ids.has(stateIdAt(x, y, z))
  return (block) => (on ? townPlaceCost(guard(), lidded, block?.position) : 0)
}
