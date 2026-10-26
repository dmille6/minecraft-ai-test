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
// or, when the reference cell is empty now, possibly IN the reference cell (lidPlaceSurcharge below: the Paper finding).
// exclusionAreasPlace would have been handed blockC for getMoveForward's bridge, the cell ABOVE its placement (2.4.5; fixed
// upstream in PrismarineJS/mineflayer-pathfinder#351, merged 2025-08-18, unreleased: npm's latest is still 2.4.5).
// `useOne` entries (a fence gate opened, nothing placed) are skipped.
//
// THE NUMBER: 20 per guarded placement. A tower from a chest top pays for the lid block (and, as planned, for the next one up:
// its reference is the lid cell, still air at planning time, so the lid is counted too -- an over-price near
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
// CAPPED SEARCHES (Codex r2 P1; Claude r3): planDigApproach is the one capped search that can place AND admits a walk -- it
// has the base-cost fallback (withoutLidPrice). reachprobe.mjs (radius 96, the walk profile) prices too and has none: its
// contract is reorder-only, so a priced miss changes candidate ORDER, never admission. The ore tunnel's profile has no
// scaffolding (no placements, no surcharge). A non-fallback approach walk re-plans priced under the 400 cap: a world change
// mid-walk can fail where the base would re-plan -- rare and bounded, accepted. The fallback's walk holds the price off for
// the whole bot (one price object), so any re-plan in that walk runs at base costs: countable as `lid_fallback=1`.

/** LIDPLACE=0 -> no surcharge anywhere: every profile is exactly the base's (the rollback without a deploy). */
export const lidPlaceOn = (env = process.env) => String(env?.LIDPLACE ?? '1') !== '0'

/** The licence row's detail (index.mjs `_lidplace_mode`, once per spawn). Pure. */
export const lidPlaceModeDetail = (env = process.env) => `on=${lidPlaceOn(env) ? 1 : 0} cost=${LID_PLACE_COST} row_window_ms=${LIDPLACE_ROW_WINDOW_MS}`

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
export function placeGuarded (guard, lidded, x, y, z) { return placeGuardWhy(guard, lidded, x, y, z) !== null }
/** ...and WHY -> 'plan' (a guarded plan cell) | 'lid' (over a lidded container) | null. Pure. */
export function placeGuardWhy (guard, lidded, x, y, z) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null
  if (guard && guard.size && guard.has(k3(x, y, z))) return 'plan'
  return lidded && lidded(x, y - 1, z) ? 'lid' : null
}

/**
 * WHERE A PLACEMENT MAY LAND (lidPlaceSurcharge below judges these cells): ref + face, or ALSO the ref cell itself. The pathfinder's executor clicks face (dx, dy, dz) of
 * the reference block (x, y, z), read at EXECUTION time (index.js `refBlock = bot.blockAt(placingBlock)`), and predicts the
 * block at ref + face. The SERVER does not always agree: vanilla BlockPlaceContext places INTO the clicked cell when that cell
 * is itself replaceable (air, water, grass...). Paper 10-26 (sandbox7, the onchest scene): a bot jumping on a chest re-planned
 * from y 108, clicked the top of the AIR lid cell, and the dirt landed ON THE LID (107) while the client recorded 108.
 * But an empty reference at PLANNING time is usually a block the same move or the path before it will have placed by then (a
 * bridge's previous block, a jump-up's D under its C, a tower's previous block), and then the block lands at ref + face
 * (Claude r2 P1: a bridge's next block onto a lid read as "lands in the previous bridge cell" and went unpriced). The planner
 * cannot tell the two apart, so an empty reference yields BOTH cells and the surcharge counts the placement once if either is
 * guarded: an over-price near a guarded cell, never an under-price. `emptyAt(x, y, z)` = no collision box (unloaded: air).
 */
/**
 * THE SURCHARGE FOR ONE NEIGHBOUR -> LID_PLACE_COST x its placements that may land in a guarded cell (each counted once).
 * Pure over its inputs. `toPlace` is mineflayer-pathfinder's Move.toPlace; a `useOne` entry places nothing.
 */
export function lidPlaceSurcharge (toPlace, guard, lidded, emptyAt = null, out = null) {
  if (!Array.isArray(toPlace) || !toPlace.length) return 0
  // SCALARS ONLY in the A* step (Codex rebase r2 P3): the cells named above -- ref + face, and the ref itself
  // when it is empty -- with a record allocated only for the instrument (`out`)
  let n = 0
  for (const p of toPlace) {
    if (!p || p.useOne) continue
    const fx = p.x + (p.dx ?? 0), fy = p.y + (p.dy ?? 0), fz = p.z + (p.dz ?? 0)
    let why = null, x = fx, y = fy, z = fz
    if (emptyAt && emptyAt(p.x, p.y, p.z)) { why = placeGuardWhy(guard, lidded, p.x, p.y, p.z); if (why) { x = p.x; y = p.y; z = p.z } }
    if (!why) { why = placeGuardWhy(guard, lidded, fx, fy, fz); x = fx; y = fy; z = fz }
    if (!why) continue
    n++
    if (out) out.push({ x, y, z, why })   // the instrument's record (index.mjs `_lidplace`)
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
 * The function carries two counters: `hits` (placements it priced, ever) and `off` (> 0 while withoutLidPrice holds it).
 */
export function makeLidPlacePrice ({ registry, stateIdAt, guard = () => null, on = true }) {
  const ids = liddedStateIds(registry), empty = emptyStateIds(registry)
  const lidded = (x, y, z) => ids.has(stateIdAt(x, y, z))
  const emptyAt = (x, y, z) => empty.has(stateIdAt(x, y, z))
  const price = (toPlace, out = null) => {
    if (!on || price.off > 0) return 0
    const v = lidPlaceSurcharge(toPlace, guard(), lidded, emptyAt, out)
    if (v > 0) price.hits++
    return v
  }
  price.hits = 0
  price.off = 0
  /** The guarded landing cells of one move's toPlace -> [{ x, y, z, why }], read NOW (the instrument, path_update only). */
  price.cellsOf = (toPlace) => { const out = []; lidPlaceSurcharge(toPlace, guard(), lidded, emptyAt, out); return out }
  return price
}

/**
 * A BOUNDED SEARCH'S FALLBACK (Codex r2 P1). A surcharge after legality never deletes a neighbour, but a COST-CAPPED search
 * (A* drops a node whose g + h passes startNode.h + searchRadius: digapproach.mjs's 400 slack) can lose a route the base
 * keeps -- the surcharge spends the cap. So a capped caller whose priced search failed AFTER the price touched it runs the
 * same search, and the walk it admits, inside this: the base's costs exactly. -> fn's result. `price` null: just fn().
 */
export async function withoutLidPrice (price, fn) {
  if (!price) return fn()
  price.off++
  try { return await fn() } finally { price.off-- }
}
/** The synchronous form, for a search (getPathFromTo pumped in place). */
export function withoutLidPriceSync (price, fn) {
  if (!price) return fn()
  price.off++
  try { return fn() } finally { price.off-- }
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
      if (!n?.toPlace?.length) continue
      const add = price(n.toPlace)
      // a SCALAR marker only (Codex rebase r1 P2: no allocation in the A* step); the chosen path's cells are read in path_update
      if (add > 0) { n.cost += add; n.lidPlace = add }
    }
    return ns
  }
  movements.__lidPrice = true
  return movements
}

/**
 * THE INSTRUMENT (`_lidplace`, coordinator 10-26): the priced moves of a path the planner CHOSE -> null, or
 * { moves, surcharge, cells: [{ x, y, z, why }] }. A move carries the scalar `lidPlace` (its surcharge) only when
 * installLidPrice priced it, so a path with none says the price never bit on the route actually taken; `cellsOf` (the
 * price's own, makeLidPlacePrice) names the cells of the priced moves only.
 */
export function chosenLidPlaces (path, cellsOf = null) {
  if (!Array.isArray(path)) return null
  let moves = 0, surcharge = 0
  const cells = []
  for (const n of path) {
    if (!(n?.lidPlace > 0)) continue
    moves++
    surcharge += n.lidPlace
    if (cellsOf) cells.push(...cellsOf(n.toPlace))
  }
  return moves ? { moves, surcharge, cells } : null
}
/** THE SAMPLE: one row per distinct chosen set of cells per window -> boolean. `seen` is a Map the caller keeps. Pure
 *  given `now`. A re-plan of the same route (path_update fires on every partial) is not a new row. */
export const LIDPLACE_ROW_WINDOW_MS = 30_000
export function lidplaceRowDue (seen, key, now, windowMs = LIDPLACE_ROW_WINDOW_MS) {
  const last = seen.get(key)
  if (last !== undefined && now - last < windowMs) return false
  seen.set(key, now)
  if (seen.size > 64) for (const [k, t] of seen) if (now - t >= windowMs) seen.delete(k)
  return true
}
/** The row's detail, key=value (a read parses fields, never prose). At most `max` cells are named; n= counts them all. */
export function lidplaceRowDetail (c, { status = '?', profile = '?', goal = '?', off = 0, max = 4 } = {}) {
  const named = c.cells.slice(0, max).map(q => `${q.x},${q.y},${q.z}:${q.why}`).join('|')
  const lids = c.cells.filter(q => q.why === 'lid').length
  return `moves=${c.moves} n=${c.cells.length} lid=${lids} plan=${c.cells.length - lids} surcharge=${c.surcharge} cells=${named || '-'} ` +
         `status=${status} profile=${profile} goal=${goal} off=${off}`
}

/** THE POSITIVE CONTROL for a zero `_lidplace` count (Claude rebase review P2): the price's own counter, every
 *  LIDPLACE_HITS_MS, so a dead price and a perfectly-avoided lid do not read the same. Pure. */
export const LIDPLACE_HITS_MS = 10 * 60_000
export const lidplaceHitsDetail = (price, prevHits) => `hits=${(price?.hits ?? 0) - (prevHits ?? 0)} total=${price?.hits ?? 0} off=${price?.off ?? 0}`
