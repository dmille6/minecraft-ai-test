// LIDPLACE-01: THE PATHFINDER'S SCAFFOLD NEVER CHOOSES A CHEST'S LID OR A TOWN-PLAN CELL WHEN ANY OTHER CELL WILL DO.
// Pure decisions + one installer; index.mjs hands in the world's state-id read and the plan's guard set.
//
// WHY (diagnosed 10-26): moves.exclusionAreasPlace held only the protected-zone price, so a pillar-up or bridge block (dirt,
// cobble) could land on a container's lid or in a town-plan cell. The showcase: Gale towered for spruce_log (10-25 19:06Z)
// on top of found-01's store chest at -9,71,-2 -- dirt at -9,72 and -9,73 -- and tripwire G3 stopped every bot for 18 h.
// Fleet: `_lid_clear outcome=dug` 37 in 7 d across 16 pools (~5 lids a day covered by bot-placed dirt/cobble). Breaking a
// plan cell is already priced (townplan.mjs planBreakCost); placing was not.
//
// A SURCHARGE ON A LEGAL MOVE, NOT AN exclusionAreasPlace ENTRY -- because an entry there can delete a move. mineflayer-
// pathfinder 2.4.5 adds every exclusion function into the move's cost INSIDE getMoveUp / getMoveJumpUp / getMoveForward and
// drops the move as soon as the running cost passes 100 (lib/movements.js, every `if (cost > 100) return`). So ANY positive
// place price is a veto for a move the base already prices near 100: Codex r1 P1 reproduced it with the real A* -- a bot on a
// chest at the bottom of a bedrock pit, an iron-block ceiling to dig by hand, inside a death disc: the base's one move cost 98
// and got out; +10 made it 108, zero neighbours, noPath. That is the composition trap the working rules name.
// So the price is added AFTER the library has decided which moves are legal: installLidPrice wraps getNeighbors, and adds
// LID_PLACE_COST to the cost of a neighbour for each guarded cell in its own `toPlace` list. Every move the base offers is
// still offered (the A* only orders them differently); no cost can cross a threshold that is no longer being checked.
//
// IT ALSO READS THE RIGHT CELL. A toPlace entry is { x, y, z, dx, dy, dz }: the reference block and the face, so the block
// lands at (x + dx, y + dy, z + dz) -- what the executor sends (index.js `bot.placeBlock(refBlock, new Vec3(dx, dy, dz))`) --
// or, when the reference cell is itself empty, IN the reference cell (landingCell below: the Paper finding).
// exclusionAreasPlace would have been handed blockC for getMoveForward's bridge, the cell ABOVE its placement (2.4.5; fixed
// upstream in PrismarineJS/mineflayer-pathfinder#351, merged 2025-08-18, unreleased: npm's latest is still 2.4.5).
// `useOne` entries (a fence gate opened, nothing placed) are skipped.
//
// THE NUMBER: 20 per guarded placement. A tower from a chest top pays for the lid block (and, as planned, for the next one up:
// its reference is the lid cell, still air at planning time, so landingCell judges it as landing there -- an over-price near
// a lid, never an under-price), and stepping off to tower beside it costs a drop (1) plus one more tower step (1 + placeCost
// 5) = 7, so the open side wins by 13 or more; a reserved plan cell or a stand costs a detour of ~20 blocks before it is used. Never a veto: a bot whose only way out
// is the lid tower still takes it (the chain tests). The A* explores a little more before it takes a priced move; 20 is
// about one death-disc cell crossing (deathsites.mjs: 16 per priced cell).
//
// WHAT IS GUARDED (placeGuardCells + the lid test):
//   - every placed or reserved plan cell (planFurnitureCells' cells -- the break price's data) and its stand, feet and head
//     (keepouts' NEVER tier: a block there makes the furniture unreachable, G3's "unreachable")
//   - the cell above a placed or reserved plan CHEST cell (a reserved site's lid, before the chest exists)
//   - the cell above ANY chest-like block the bot's world shows: chest, trapped chest, ender chest, the eight copper chests of
//     1.21.9+ (the fleet runs 1.21.11: Claude r1 P2) -- town, found or bank. Barrels, furnaces and crafting tables open under
//     anything (lidrule.mjs; vanilla), so a block on them shuts nothing. Shulker boxes are NOT priced: one opens toward its
//     FACING, which this one-cell-below test cannot see (Codex r1 P2), and no bot crafts one (no End in these worlds).
//
// NOT HERE: the reflex and skill pillars that call bot.placeBlock directly (reflex.mjs air/scaffold/entombment, skills.mjs
// ride-floor-down) never consult the pathfinder. Survival places where it must (protectzone's rule too).

/** LIDPLACE=0 -> no surcharge anywhere: every profile is exactly the base's (the rollback without a deploy). */
export const lidPlaceOn = (env = process.env) => String(env?.LIDPLACE ?? '1') !== '0'

/** The surcharge per guarded placement (see THE NUMBER above). Added after legality: it can never delete a move. */
export const LID_PLACE_COST = 20
/** Blocks whose lid a solid block above keeps shut (vanilla ChestBlock / EnderChestBlock / CopperChestBlock). */
export const LIDDED_RE = /^(chest|trapped_chest|ender_chest|(?:waxed_)?(?:(?:exposed|weathered|oxidized)_)?copper_chest)$/
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
      if (LIDDED_RE.test(String(c.kind ?? ''))) out.add(k3(x, y + 1, z))
      if (Array.isArray(c.stand)) { out.add(k3(c.stand[0], c.stand[1], c.stand[2])); out.add(k3(c.stand[0], c.stand[1] + 1, c.stand[2])) }
    }
  }
  return out
}

/** Is a block placed INTO (x, y, z) one to avoid? guard = placeGuardCells' set (or null); lidded(x, y, z) = a lidded
 *  container stands there. Pure. */
export function placeGuarded (guard, lidded, x, y, z) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return false
  return !!(guard && guard.size && guard.has(k3(x, y, z))) || !!(lidded && lidded(x, y - 1, z))
}

/**
 * WHERE A PLACEMENT LANDS -> the cell. Pure. The pathfinder's executor clicks face (dx, dy, dz) of the reference block (x, y, z)
 * and predicts the block at ref + face. The SERVER does not always agree: vanilla BlockPlaceContext places INTO the clicked
 * cell when that cell is itself replaceable (air, water, grass...). The executor clicks an AIR reference when the A* was
 * re-planned from a body in mid-jump: the start node is the floored position, getMoveUp's reference is the cell under it,
 * and that cell is air. Paper 10-26 (sandbox7, the onchest scene): a bot jumping on a chest re-planned from y 108, clicked
 * the top of the air lid cell, and the dirt landed ON THE LID (107) while the client recorded 108. So an empty reference
 * means the block lands in the reference cell. `emptyAt(x, y, z)` = that cell has no collision box (unloaded reads as air).
 * The world is read as it is NOW, so a reference the same move (or the path before it) will have filled -- a jump-up's C on its
 * D, the second block of a tower -- is judged as landing in that reference cell: near a guarded cell that over-prices a move
 * that does cover it; it never under-prices one.
 */
export function landingCell (p, emptyAt) {
  if (!p) return null
  if (emptyAt && emptyAt(p.x, p.y, p.z)) return { x: p.x, y: p.y, z: p.z }
  return { x: p.x + (p.dx ?? 0), y: p.y + (p.dy ?? 0), z: p.z + (p.dz ?? 0) }
}

/**
 * THE SURCHARGE FOR ONE NEIGHBOUR -> LID_PLACE_COST x the guarded cells its placements land in. Pure over its inputs.
 * `toPlace` is mineflayer-pathfinder's Move.toPlace; a `useOne` entry places nothing; landingCell says where each lands.
 */
export function lidPlaceSurcharge (toPlace, guard, lidded, emptyAt = null) {
  if (!Array.isArray(toPlace) || !toPlace.length) return 0
  let n = 0
  for (const p of toPlace) {
    if (!p || p.useOne) continue
    const c = landingCell(p, emptyAt)
    if (c && placeGuarded(guard, lidded, c.x, c.y, c.z)) n++
  }
  return n * LID_PLACE_COST
}

/** The state ids of every block with no collision box (air, cave air, water, grass, flowers...) -> Set<number>. Pure. */
export function emptyStateIds (registry) {
  const out = new Set()
  for (const b of registry?.blocksArray ?? Object.values(registry?.blocks ?? {})) {
    if (!b || b.boundingBox !== 'empty') continue
    const lo = b.minStateId ?? b.defaultState, hi = b.maxStateId ?? b.defaultState
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) continue
    for (let s = lo; s <= hi; s++) out.add(s)
  }
  return out
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
 * THE PRICE index.mjs installs -> (toPlace) => surcharge. `stateIdAt(x, y, z)` is the world's state id there (0 when
 * unloaded: no lid); `guard()` returns the plan's current guard set or null; `on` false -> always 0. Built once; per
 * placement it is one or two Set lookups and two state-id reads (the reference, the cell under the landing; no Block object).
 */
export function makeLidPlacePrice ({ registry, stateIdAt, guard = () => null, on = true }) {
  const ids = liddedStateIds(registry), empty = emptyStateIds(registry)
  const lidded = (x, y, z) => ids.has(stateIdAt(x, y, z))
  const emptyAt = (x, y, z) => empty.has(stateIdAt(x, y, z))
  return (toPlace) => (on ? lidPlaceSurcharge(toPlace, guard(), lidded, emptyAt) : 0)
}

/**
 * INSTALL THE SURCHARGE on a Movements: an OWN getNeighbors that asks the one it had (the library's) first and only then
 * adds price(n.toPlace) to each neighbour's cost. A plain function, never bound (watermoves.mjs installShoreEgress: index.mjs
 * derives every other profile with Object.create(proto) + Object.assign, which copies this property, and `this` must be the
 * derived profile so its canDig / towers / exclusions are the ones the library reads). Idempotent. -> the movements.
 */
export function installLidPrice (movements, price) {
  if (!movements || movements.__lidPrice || typeof price !== 'function') return movements
  const inner = movements.getNeighbors
  movements.getNeighbors = function (node) {
    const ns = inner.call(this, node)
    for (const n of ns) {
      const add = n?.toPlace?.length ? price(n.toPlace) : 0
      if (add > 0) n.cost += add
    }
    return ns
  }
  movements.__lidPrice = true
  return movements
}
