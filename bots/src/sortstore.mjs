// SORTSTORE-01: THE SORTED STOREHOUSE (owner 11-01 item 1 "sorted storehouse + sign labels"; town plan 10-20 "sorted deposits:
// deposit to the chest holding that item / its group chest, a tidy-up chore", "signs as labels, not item frames"). PURE: the
// switches, the category homes read from the town plan, the deposit's container order, the search's preference, the tidy's moves,
// and the labels. Nothing here touches a bot, a window or a file; skills.mjs does the clicks with the verified primitives the
// town deposit and the withdraw verbs already use.
//
// THE CATEGORIES ARE THE TOWN PLAN'S OWN GROUPS (townindex.mjs GROUP_ORDER, v1: metal, fuel, stone, wood, tools, farm, valuable,
// build, earth, misc), and THE HOMES ARE THE ONES THE TOWN ALREADY CHOSE from what it banks: in a greenfield town found-01 gives each
// group a store cell the first time a bot banks a stack of it (found.mjs foundAssign / F3: role 'home', group g), the first chest
// is the OVERFLOW; in a retrofit town the plan's groups.homes / groups.overflow (townindex.mjs allocateHomes). No new map, no new
// file: a town with no plan, or a plan with no homes, sorts nothing (every rule here is then today's behaviour).
//
// WHAT IT DOES
//   (a) THE DEPOSIT ORDER (town_deposit): the containers in reach, the HOMES of the groups the bag will bank first (each takes only
//       its own group), then the overflow, then any other town container, then the other groups' homes -- the last three take
//       anything. A full home sends its stacks on down the order: a deposit is never refused because a home is full.
//   (b) THE DEPOSIT VERB: with no chest named, its first chest is the home of the group it banks most of (else the overflow).
//   (c) THE SEARCH (withdraw, withdraw_pick, toolkit, the build draws, the smelt job): the homes of the needs' groups first within
//       each of the search's own tiers (a container known to hold the need stays ahead of one that is only its home).
//   (d) THE TIDY: a stack the index shows in the wrong home (or a homed group's stack in the overflow) is moved to its home, when
//       the index shows the home has room. Bounded: one source container and SORT_MOVE_STACKS stacks per visit, a storehouse
//       `due` visit only (after every open project: never during building).
//   (e) THE LABELS: a wall sign above each storehouse chest naming its category (sign-proof.cjs, Paper 1.21.8 11-01: a placed sign
//       opens the editor; an update without one is refused by the server; a right click re-opens it).
//
// SORTSTORE=off is the kill switch for all of it (unset: on only in SORTSTORE_POOLS, default 'showcase'); SORT_TIDY=off and
// SORT_SIGNS=off stop the tidy and the labels alone.

import { groupOfItem } from './townindex.mjs'

const onOff = v => { const s = String(v ?? '').trim().toLowerCase(); return ['on', '1', 'true', 'yes'].includes(s) ? true : ['off', '0', 'false', 'no'].includes(s) ? false : null }
/** THE SWITCHES -> { on, tidy, signs }. Pure. */
export function sortSwitches (env = process.env, pool = '') {
  const m = onOff(env?.SORTSTORE)
  const pools = String(env?.SORTSTORE_POOLS ?? 'showcase').split(',').map(s => s.trim()).filter(Boolean)
  const on = m ?? pools.includes(String(pool))
  return { on, tidy: on && onOff(env?.SORT_TIDY) !== false, signs: on && onOff(env?.SORT_SIGNS) !== false }
}

const isXYZ = a => Array.isArray(a) && a.length === 3 && a.every(Number.isFinite)
const kOf = a => `${a[0]},${a[1]},${a[2]}`

/**
 * THE CATEGORY HOMES OF A PLAN -> { byKey: Map k -> { group, role }, homeOf: Map group -> [k], overflow: [k] }. Pure.
 * Greenfield: the store plot's PLACED cells (role 'home' with a group, role 'overflow'). Retrofit: groups.homes / groups.overflow.
 * A key is "x,y,z" (a double chest's either half is matched by the caller).
 */
export function sortHomes (plan) {
  const byKey = new Map(), homeOf = new Map(), overflow = []
  const addHome = (k, g) => { if (byKey.has(k)) return; byKey.set(k, { group: g, role: 'home' }); if (!homeOf.has(g)) homeOf.set(g, []); homeOf.get(g).push(k) }
  const addOver = k => { if (byKey.has(k)) return; byKey.set(k, { group: null, role: 'overflow' }); overflow.push(k) }
  const store = (plan?.plots ?? []).find(p => p?.id === 'store')
  for (const c of store?.cells ?? []) {
    if (!isXYZ(c?.at) || c.state !== 'placed' || c.kind !== 'chest') continue
    if (c.role === 'home' && typeof c.group === 'string' && c.group) addHome(kOf(c.at), c.group)
    else if (c.role === 'overflow') addOver(kOf(c.at))
  }
  const g = plan?.groups
  if (g && g.status === 'allocated') {
    for (const [grp, ks] of Object.entries(g.homes ?? {})) for (const k of ks ?? []) if (typeof k === 'string') addHome(k, grp)
    for (const k of g.overflow ?? []) if (typeof k === 'string') addOver(k)
  }
  return { byKey, homeOf, overflow }
}
/** Has the plan any home at all? (no homes: nothing sorts). Pure. */
export const sortsAnything = homes => !!homes && homes.homeOf.size > 0

/** The category of an item name (the plan's group map). Pure. */
export const itemGroup = name => groupOfItem(name)
/** The category of a SEARCH NEED (withdrawpick.mjs NEEDS, townSearchView's needs) -> group. Pure. */
export function needGroup (need) {
  const n = String(need ?? '')
  if (n === 'pick' || n === 'trippick' || n === 'pickaxe' || n === 'trip_pickaxe') return 'tools'
  if (n === 'planks' || n === 'logs' || n === 'log') return 'wood'
  return groupOfItem(n)
}

/**
 * THE DEPOSIT TIER of a container for a bag banking `groups` -> 0 its own home (one of the groups' homes), 1 the overflow,
 * 2 a container the plan does not name, 3 another group's home. Pure. `key` may be either half of a double chest (`alt`).
 */
export function depositTier (homes, key, groups = [], alt = null) {
  const e = homes?.byKey?.get(key) ?? (alt ? homes?.byKey?.get(alt) : null)
  if (!e) return 2
  if (e.role === 'overflow') return 1
  return groups.includes(e.group) ? 0 : 3
}
/**
 * THE TOWN DEPOSIT'S CONTAINER ORDER -> the same items, re-ordered (stable: the caller's own order, nearest first, breaks ties).
 * Pure. `list` = [{ k, alt? , ... }].
 */
export function depositOrder (homes, list = [], groups = []) {
  return (Array.isArray(list) ? list : []).map((c, i) => ({ c, i, t: depositTier(homes, c.k, groups, c.alt ?? null) }))
    .sort((a, b) => a.t - b.t || a.i - b.i).map(x => x.c)
}
/** WHAT A CONTAINER TAKES in the sorted deposit -> name => bool: a home of a group the bag banks takes that group only; every
 *  other container (overflow, unnamed, another group's home: the fallbacks) takes anything. Pure. */
export function acceptsFor (homes, key, groups = [], alt = null) {
  const e = homes?.byKey?.get(key) ?? (alt ? homes?.byKey?.get(alt) : null)
  if (e?.role === 'home' && groups.includes(e.group)) return name => itemGroup(name) === e.group
  return () => true
}
/** How many containers a sorted deposit may try (each home is one more try than the unsorted two): homes of the bag's groups +
 *  the overflow + one fallback + one last any-name pass over a roomy own home, at least 2, at most SORT_MAX_TRIES (the 45 s
 *  budget bounds it too: the homes stand side by side in the storehouse). Pure. */
export const SORT_MAX_TRIES = 7
export function sortTries (homes, groups = []) {
  const own = [...new Set(groups)].filter(g => homes?.homeOf?.has(g)).length
  return Math.max(2, Math.min(SORT_MAX_TRIES, own + 3))
}

/**
 * THE DEPOSIT VERB'S FIRST CHEST -> "x,y,z" | null: the home of the group the plan banks most of (items), else the overflow.
 * Pure. `plan` = depositPlan's [{ name, count }].
 */
export function sortDepositTarget (homes, plan = []) {
  if (!sortsAnything(homes)) return null
  const by = new Map()
  for (const e of plan ?? []) { if (!e?.name) continue; const g = itemGroup(e.name); by.set(g, (by.get(g) ?? 0) + (Number(e.count) || 0)) }
  const ranked = [...by.entries()].filter(([g]) => homes.homeOf.has(g)).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
  if (ranked.length) return homes.homeOf.get(ranked[0][0])[0]
  return homes.overflow[0] ?? null
}

/** THE SEARCH'S PREFERENCE -> Set of keys: the homes of the needs' groups. Pure. */
export function searchPrefer (homes, needs = []) {
  const out = new Set()
  for (const n of needs ?? []) for (const k of homes?.homeOf?.get(needGroup(n)) ?? []) out.add(k)
  return out
}
/** The withdraw sweep's first containers for an item -> [k] (its group's homes, in plan order). Pure. */
export const withdrawPrefer = (homes, item) => [...(homes?.homeOf?.get(itemGroup(item)) ?? [])]

// ---- the tidy ---------------------------------------------------------------------------------------------------------
/** Stacks moved per tidy visit (one source container; the bag must have this many free slots plus SORT_BAG_SPARE). */
export const SORT_MOVE_STACKS = 6
export const SORT_BAG_SPARE = 2
/** A bot's tidy visits at most this often (and a storehouse upkeep visit at all only when one is due). */
export const SORT_VISIT_GAP_MS = 10 * 60_000
/** A move that failed (the take or the put) is not planned again by this bot for this long, per source and name. */
export const SORT_MOVE_BACKOFF_MS = 30 * 60_000

/**
 * THE TIDY'S MOVES -> { from, moves: [{ name, slots, count, to }] } | null. Pure.
 *   entries   { k: { names: { name: [count, slots] }, used, size } } -- KNOWN, fresh index entries only (the caller filters);
 *             a container with no entry is never a source or a target (its room is not known)
 *   maxSlots  the stacks this visit may carry (bag free slots less the spare), at most SORT_MOVE_STACKS
 *   skip      (from, name) => bool: a move in its back-off
 * A stack is misplaced when it sits in a HOME of another group (its own group's home, else the overflow, is its place) or in the
 * OVERFLOW while its group has a home. Its target is the first home of its group (else the overflow) whose entry shows a free
 * slot after the moves already planned. The source with the most misplaced slots goes first (one source per visit).
 */
export function tidyMoves (homes, entries = {}, { maxSlots = SORT_MOVE_STACKS, skip = () => false } = {}) {
  if (!sortsAnything(homes) || !(maxSlots > 0)) return null
  const free = new Map()
  for (const [k, e] of Object.entries(entries ?? {})) if (homes.byKey.has(k) && Number.isFinite(e?.size) && Number.isFinite(e?.used)) free.set(k, Math.max(0, e.size - e.used))
  const placeOf = g => homes.homeOf.get(g) ?? homes.overflow
  const cands = []
  for (const [from, e] of homes.byKey) {
    const ent = entries?.[from]
    if (!ent?.names || !free.has(from)) continue
    const moves = []
    for (const [name, v] of Object.entries(ent.names)) {
      const g = itemGroup(name)
      const slots = Number(v?.[1]) || 0, count = Number(v?.[0]) || 0
      if (!(slots > 0) || !(count > 0)) continue
      const misplaced = e.role === 'overflow' ? homes.homeOf.has(g) : e.group !== g
      if (!misplaced || skip(from, name)) continue
      const places = placeOf(g).filter(k => k !== from)
      if (!places.length) continue
      moves.push({ name, slots, count, places })
    }
    if (moves.length) cands.push({ from, moves, n: moves.reduce((t, m) => t + m.slots, 0) })
  }
  cands.sort((a, b) => b.n - a.n || (a.from < b.from ? -1 : 1))
  for (const c of cands) {
    const left = new Map(free)
    let budget = Math.min(maxSlots, SORT_MOVE_STACKS)
    const out = []
    // the biggest misplaced stacks first (whole stacks: a move carries every slot of a name, up to the budget)
    for (const m of c.moves.sort((a, b) => b.slots - a.slots || (a.name < b.name ? -1 : 1))) {
      if (budget <= 0) break
      const to = m.places.find(k => (left.get(k) ?? 0) > 0)
      if (!to) continue
      const slots = Math.min(m.slots, budget, left.get(to))
      const count = slots >= m.slots ? m.count : Math.floor(m.count * slots / m.slots)
      if (!(count > 0)) continue
      left.set(to, left.get(to) - slots); budget -= slots
      out.push({ name: m.name, slots, count, to })
    }
    if (out.length) return { from: c.from, moves: out }
  }
  return null
}

// ---- the labels -------------------------------------------------------------------------------------------------------
/** The sign text per category (four lines, each short enough to read at 15 characters). */
export const LABELS = Object.freeze({
  metal: ['METAL', 'iron, copper', 'gold, ingots'],
  fuel: ['FUEL', 'coal, charcoal'],
  stone: ['STONE', 'cobble, bricks', 'stone'],
  wood: ['WOOD', 'logs, planks', 'sticks'],
  tools: ['TOOLS', 'picks, axes', 'shovels'],
  farm: ['FARM', 'seeds, saplings', 'bone meal'],
  valuable: ['VALUABLES', 'diamond, lapis', 'redstone'],
  build: ['BUILDING', 'torches, glass', 'stations'],
  earth: ['EARTH', 'dirt, sand', 'gravel, clay'],
  misc: ['MISC'],
  overflow: ['OVERFLOW', 'anything', 'when full'],
})
export const labelOf = e => (e?.role === 'overflow' ? LABELS.overflow : LABELS[e?.group] ?? [String(e?.group ?? 'MISC').toUpperCase().slice(0, 15)])
/** The text a label's lines make (mineflayer updateSign's argument). Pure. */
export const labelText = lines => lines.slice(0, 4).join('\n')
/** Does a sign's front text (prismarine-block getSignText()[0]: lines joined by \n) say the label? Pure. */
export function labelMatches (front, lines) {
  const got = String(front ?? '').split('\n').map(s => s.trim())
  for (let i = 0; i < 4; i++) if ((got[i] ?? '') !== (lines[i] ?? '').trim()) return false
  return true
}
const WALL_ROLES = new Set(['base', 'upper', 'corner'])
/**
 * THE LABEL SPOTS of a storehouse record -> [{ chest, at, wall, face, lines }]. Pure. Every home or overflow chest of `homes` whose
 * cell above (`at`, the chest's own y + 1) has a horizontal neighbour that is one of the record's WALL cells (base, upper or corner:
 * never a window or the doorway) -- the sign hangs on that wall's face, above the chest (a wall sign has no collision box: the lid
 * still opens, Paper 11-01). Of two walls (a corner chest) the one straight past the chest from its stand.
 *   stands  Map k -> [x, y, z] (the plan cell's stand), optional
 */
export function signSpots (rec, homes, stands = new Map()) {
  const out = []
  if (!rec || !Array.isArray(rec.cells) || !homes) return out
  const wall = new Map()
  for (const c of rec.cells) if (isXYZ(c?.at) && WALL_ROLES.has(c.role)) wall.set(kOf(c.at), c)
  const box = rec.box
  for (const [k, e] of homes.byKey) {
    const [x, y, z] = k.split(',').map(Number)
    if (![x, y, z].every(Number.isFinite)) continue
    if (Array.isArray(box) && box.length === 4 && !(x > box[0] && x < box[2] && z > box[1] && z < box[3])) continue   // inside the walls only
    const at = [x, y + 1, z]
    const st = stands.get?.(k)
    const dx = Array.isArray(st) ? Math.sign(x - st[0]) : 0, dz = Array.isArray(st) ? Math.sign(z - st[2]) : 0
    const order = [[dx, 0], [0, dz], [1, 0], [-1, 0], [0, 1], [0, -1]].filter(([a, b]) => Math.abs(a) + Math.abs(b) === 1)
    const w = order.map(([a, b]) => [x + a, y + 1, z + b]).find(p => wall.has(kOf(p)))
    if (!w) continue
    out.push({ chest: k, at, wall: w, face: [at[0] - w[0], 0, at[2] - w[2]], lines: labelOf(e), stand: Array.isArray(st) ? [...st] : null })
  }
  return out.sort((a, b) => (a.chest < b.chest ? -1 : a.chest > b.chest ? 1 : 0))
}
/**
 * WHAT A LABEL SPOT NEEDS NOW -> 'ok' | 'place' | 'edit' | 'blocked' | 'unknown'. Pure.
 *   block  the label cell's block ({ name }) or null (unloaded)
 *   front  its sign's front text (getSignText()[0]) when it is a sign
 *   wallOk the wall block reads solid
 */
export function spotNeed (spot, block, front = null, wallOk = true) {
  if (!block) return 'unknown'
  const n = String(block.name ?? '')
  if (/_wall_sign$/.test(n)) return labelMatches(front, spot.lines) ? 'ok' : 'edit'
  if (n === 'air' || n === 'cave_air') return wallOk ? 'place' : 'blocked'
  return 'blocked'
}
/** Tries per label spot per bot (a place or an edit that did not take). */
export const SIGN_TRIES = 3

/** The `_sortstore_mode` row (once per spawn). */
export const sortModeDetail = (sw, homes = null) =>
  `phase=mode sort=${sw.on ? 'on' : 'off'} tidy=${sw.tidy ? 'on' : 'off'} signs=${sw.signs ? 'on' : 'off'} homes=${homes ? [...homes.homeOf.keys()].join('/') || '-' : '?'} overflow=${homes?.overflow?.length ?? '?'} move_stacks=${SORT_MOVE_STACKS}`
