// WAREHOUSE-01 (bagfix-03show; OWNER 11-17): SORTED CHESTS PER KIND ARE THE TOWN'S MAIN STORE.
// "lets keep things organized and well designed ... we need to make sure all chests are accessible and easy for the bots to navigate"
// (a lane holds ~164 blocks and banks 128 in 72 s; a chest holds 1,728 in 0.4 s). The owner then chose a PURPOSE-BUILT storehouse
// (a cross of wings, columns three chests high) over raising the old hall, so everything here is written against an ABSTRACT LAYOUT:
//
//   layout = { id, columns: [{ col, kind, section, chests: [[x, y, z], ...] bottom to top, stand: [x, y, z] }] }
//
// A COLUMN is one kind's: its chest cells bottom to top (a tier is filled before the one above; a cell with no chest yet is placed
// from the chests a bot carries) and the aisle cell it is opened from. The SAME code serves the old storehub hall today (18 columns
// of one chest: whHallLayout) and the new storehouse's stacked columns later (its record lists them). PURE: what each column is for,
// the layout of the old hall, a name's column, the deposit's order, a kind's room and cap, the next chest to place, the clerk's homes
// and the ACCESS PROOF. skills.mjs reads the hall's record, banks, and writes the pool's record of the columns (the label).
// WAREHOUSE unset or off: release 2 exactly (the hall's chests take any deposit, the clerk sorts by section, nothing reads a column);
// WAREHOUSE=hall turns the old hall's columns on (warehouseMode below).

const isOff = v => ['off', '0', 'false', 'no'].includes(String(v ?? '').trim().toLowerCase())
/**
 * THE SWITCH (rc2: the columns are DARK by default) -> 'hall' | 'off' | 'auto'. Pure.
 *   WAREHOUSE=hall   the old hall's 18 chests are columns NOW (the rig, the tests: what the Paper rig proved)
 *   WAREHOUSE=off    no column layout, ever -- even once the new storehouse stands
 *   unset / other    'auto': NO column layout over the old hall (release 2 exactly); the layout comes from the `warehouse` record
 *                    once that building stands (the body's wiring: nothing reads `auto` as a layout before then)
 * warehouseOn: is the OLD HALL's column layout on -> bool (only `hall`).
 */
export const warehouseMode = (env = {}) => { const v = String(env?.WAREHOUSE ?? '').trim().toLowerCase(); return v === 'hall' ? 'hall' : isOff(v) ? 'off' : 'auto' }
export const warehouseOn = (env = {}) => warehouseMode(env) === 'hall'
export const WAREHOUSE = Object.freeze({ on: warehouseOn(typeof process !== 'undefined' ? process.env : {}), mode: warehouseMode(typeof process !== 'undefined' ? process.env : {}) })
/** A bot's reach to open a chest (skills.mjs STATION_REACH) and its eye above its feet. */
export const WH_REACH = 4.5
export const WH_EYE = 1.62
/** A bag banks a kind into its column from this many above its keep (any surplus when the bag is pressed). */
export const WH_MIN = 16

const MINERAL = '(coal|iron|copper|gold|lapis|redstone|diamond|emerald|raw_iron|raw_copper|raw_gold)'
/** A column's use: `kind` its id (the label), `names` exact item names, `rx` a pattern, `section` the store's section it stands in
 *  (the new storehouse's wings; storehub.mjs HUB_SECTIONS for the old hall's signs). */
const use = (kind, section, names, rx = null) => Object.freeze({ kind, section, names: Object.freeze(names), rx })
export const WH_USES = Object.freeze({
  cobblestone: use('cobblestone', 'stone', ['cobblestone']),
  cobbled_deepslate: use('cobbled_deepslate', 'stone', ['cobbled_deepslate']),
  dirt: use('dirt', 'earth', ['dirt', 'coarse_dirt', 'rooted_dirt']),
  stone: use('stone', 'stone', ['stone']),
  logs: use('logs', 'wood', [], /_(log|wood|stem)$/),
  planks: use('planks', 'wood', ['stick'], /_planks$/),
  gravel: use('gravel', 'earth', ['gravel', 'flint']),
  sand: use('sand', 'earth', ['sand', 'red_sand']),
  deepslate: use('deepslate', 'stone', ['deepslate', 'tuff']),
  stones: use('stones', 'stone', ['andesite', 'diorite', 'granite']),
  parts: use('parts', 'build', ['lantern', 'bricks', 'brick', 'glass', 'glass_pane', 'torch'], /(_wall|_stairs|_slab|_fence|_fence_gate|_bricks|_door|_trapdoor|_sign)$/),
  valuables: use('valuables', 'valuable', ['diamond', 'emerald', 'lapis_lazuli', 'redstone', 'coal', 'charcoal', 'iron_ingot', 'copper_ingot', 'gold_ingot', 'iron_nugget', 'gold_nugget'], new RegExp(`^${MINERAL}(_block)?$`)),
  tools: use('tools', 'tools', ['shears', 'bucket', 'flint_and_steel', 'fishing_rod'], /_(pickaxe|axe|shovel|hoe|sword)$/),
  farm: use('farm', 'farming', ['wheat_seeds', 'beetroot_seeds', 'sugar_cane', 'wheat', 'hay_block', 'clay', 'clay_ball', 'bone_meal', 'snowball', 'snow_block'], /(_sapling|_propagule)$/),
  overflow: use('overflow', 'overflow', []),
})
/** THE USE AN ITEM NAMES -> a WH_USES kind (never 'overflow') | null (no use of its own: its section's column, or the overflow). Pure. */
export function whKindOf (name) {
  const n = String(name ?? '')
  if (!n) return null
  for (const u of Object.values(WH_USES)) if (u.kind !== 'overflow' && (u.names.includes(n) || (u.rx && u.rx.test(n)))) return u.kind
  return null
}
/** The column kind a hall SECTION's other items go to (storehub.mjs hubSectionOf's ids): what no use names is still sorted. */
const SECTION_KIND = Object.freeze({ stone: 'stones', wood: 'planks', metal: 'valuables', fuel: 'valuables', valuable: 'valuables', tools: 'tools', build: 'parts', earth: 'overflow', food: 'farm', farming: 'farm', plants: 'farm' })
/** THE COLUMN KIND OF ANY ITEM -> a kind: its use's, else its section's (`section`: storehub.mjs hubSectionOf(name)), else
 *  'overflow'. Pure. Every item has a column, so a sorted deposit never refuses for want of a category. */
export const whSectionOf = (name, section = null) => whKindOf(name) ?? SECTION_KIND[section] ?? 'overflow'
/** DOES A COLUMN OF `kind` TAKE `name`? -> bool. Pure. Its own kind's items; the overflow takes anything. */
export const whTakes = (kind, name, section = null) => kind === 'overflow' || whSectionOf(name, section) === kind

/**
 * THE OLD HALL'S COLUMNS by blueprint cell "u,v" (storehub.mjs HALL_LAYOUT's 18 cells; the doorway is the front wall's middle, u 9).
 * The back wall is what a bot faces coming in, its middle nearest the door: cobblestone there, cobbled deepslate beside it, then
 * dirt and stone, logs and planks at the ends. The front wall's two chests by the door take gravel and sand; the corners the
 * builder's parts; the side walls the valuables, the tools, the farm's loose kinds and the overflow.
 */
export const WH_HALL = Object.freeze({
  '8,8': 'cobblestone', '10,8': 'cobblestone', '6,8': 'cobbled_deepslate', '12,8': 'cobbled_deepslate', '4,8': 'dirt', '14,8': 'stone', '2,8': 'logs', '16,8': 'planks',
  '6,2': 'gravel', '12,2': 'sand', '4,2': 'deepslate', '14,2': 'stones', '2,2': 'parts', '16,2': 'parts',
  '2,4': 'valuables', '2,6': 'tools', '16,4': 'farm', '16,6': 'overflow',
})
/**
 * THE OLD HALL AS A LAYOUT -> { id: 'storehub', columns } | null. Pure. `chests` storehub.mjs hubChestsOf(rec) ([{ at, stand }] in
 * world cells, HALL_LAYOUT's order), `cells` HALL_LAYOUT ([{ u, v }]). One chest a column. A cell WH_HALL does not name: overflow.
 */
export function whHallLayout (chests = [], cells = []) {
  if (!Array.isArray(chests) || !chests.length || chests.length !== cells.length) return null
  const columns = chests.map((c, i) => {
    const kind = WH_HALL[`${cells[i].u},${cells[i].v}`] ?? 'overflow'
    return { col: i, kind, section: WH_USES[kind].section, chests: [c.at.slice()], stand: Array.isArray(c.stand) ? c.stand.slice() : null }
  })
  return { id: 'storehub', columns }
}
const kOf = a => `${a[0]},${a[1]},${a[2]}`
/** Every chest cell of a layout -> [{ at, k, kind, col, tier }] (tier 1 the bottom), columns in order, bottom to top. Pure. */
export function whRows (layout) {
  const out = []
  for (const c of layout?.columns ?? []) (c.chests ?? []).forEach((at, i) => out.push({ at, k: kOf(at), kind: c.kind, col: c.col, tier: i + 1 }))
  return out
}
/** The layout's chest cells -> Map("x,y,z" -> kind). Pure. */
export const whChestKinds = layout => new Map(whRows(layout).map(r => [r.k, r.kind]))
/**
 * THE CLERK'S HOMES of a layout -> storehub.mjs hubHomes' shape { byKey: Map k -> { section, role }, homeOf: Map kind -> [k],
 * overflow: [k], unsorted: [] }. Pure. A kind's chests in filling order: every column's bottom tier, then the tier above (a low
 * chest is filled before a high one, and a column's first before its neighbour's second).
 */
export function whHomes (layout) {
  const byKey = new Map(), homeOf = new Map(), overflow = []
  for (const r of whRows(layout).sort((a, b) => a.tier - b.tier || a.col - b.col)) {
    byKey.set(r.k, { section: r.kind, role: r.tier === 1 ? 'home' : 'more' })
    if (r.kind === 'overflow') overflow.push(r.k)
    else { if (!homeOf.has(r.kind)) homeOf.set(r.kind, []); homeOf.get(r.kind).push(r.k) }
  }
  return { byKey, homeOf, overflow, unsorted: [] }
}
/**
 * THE DEPOSIT'S ORDER over the containers in reach -> [index] into `keys` (the caller's nearest-first list of "x,y,z"). Pure.
 * `kinds` whChestKinds(layout); `want` the column kinds of the names the bag's plan banks. First the bag's OWN columns (nearest
 * first), then every container that is no column (the town's other chests: as before), then the overflow. Another kind's column is
 * never listed (it takes its kind only).
 */
export function whDepositOrder (keys = [], kinds = new Map(), want = new Set()) {
  const own = [], other = [], over = []
  keys.forEach((k, i) => {
    const kind = kinds.get(k)
    if (kind == null) other.push(i)
    else if (kind === 'overflow') over.push(i)
    else if (want.has(kind)) own.push(i)
  })
  return [...own, ...other, ...over]
}
/**
 * A KIND'S ROOM IN THE LAYOUT -> { chests, free, open, cap, room, over }. Pure. `full` Set of chest keys with no room for the kind
 * (yard.mjs rowFullKeys over the town index); `standing(k)` -> true | false | null (unread: the layout's word, it stands).
 *   chests  its chests that stand;  free  those not full;  open  its cells with no chest yet (the next tiers);  cap  every cell it has
 *   room    free + open (chests' worth: > 0 means the kind has a home with room -- the well is held off it, a lane is not opened)
 *   over    it HAS cells and none has room: full at its cap (the owner's cap per kind: the columns the layout gives it)
 * The overflow is never a kind's room (a kind whose columns are full is over its cap whatever the overflow holds).
 */
export function whRoom (layout, kind, { full = new Set(), standing = () => null } = {}) {
  const rows = whRows(layout).filter(r => r.kind === kind && kind !== 'overflow')
  const up = rows.filter(r => standing(r.k) !== false)
  const free = up.filter(r => !full.has(r.k)).length
  const open = rows.length - up.length
  return { chests: up.length, free, open, cap: rows.length, room: free + open, over: rows.length > 0 && free + open === 0 }
}
// ---- ROOM IS PER ITEM, AND A FAILED DEPOSIT IS THE NEWER WORD (Codex r1 on dba279290, blockers 1-3: a column that "has room" keeps the
// kind off the piles and off the well, so "room" must mean THIS item can go in -- else two correct guards make a dead end) ------------
/** How long a bot's own "this chest took none of this item" stands (an observation made after it wins). */
export const WH_FAIL_MS = 30 * 60_000
/** HAS A CHEST ROOM FOR AN ITEM NAME? -> true | false | null (never observed). Pure. An empty slot, or a partial stack of THAT name
 *  (a full chest of oak logs with one partial oak stack has no room for spruce logs). */
export function whNameRoom (obs, name, stackOf = () => 64) {
  if (!obs || !Number.isFinite(obs.size)) return null
  if ((Number(obs.used) || 0) < obs.size) return true
  const v = obs.names?.[name]
  return !!v && (Number(v[0]) || 0) < (Number(v[1]) || 0) * (Number(stackOf(name)) || 64)
}
/**
 * THE CHESTS WITH NO ROOM FOR `name` NOW -> Set("x,y,z"). Pure. The town index's latest observation decides (whNameRoom); this
 * bot's own failed deposit of the name there (`failed`: "k|name" -> until) is the newer word until an observation is made after it
 * (the admission refused it -- a cap, a stock target -- or the index was stale). Never observed and never failed: room.
 */
export function whFullFor (rows = [], name, { obsOf = () => null, failed = new Map(), now = Date.now(), stackOf = () => 64 } = {}) {
  const out = new Set()
  for (const r of rows) {
    const obs = obsOf(r.k)
    const until = failed.get(`${r.k}|${name}`) ?? 0
    const mine = until > now && !(Number.isFinite(obs?.at) && obs.at > until - WH_FAIL_MS)
    if (whNameRoom(obs, name, stackOf) === false || mine) out.add(r.k)
  }
  return out
}
/** A deposit at the column chest `at` asked for `asked` names and the re-open verified `got`: the failure marks updated -> `failed`.
 *  Pure but for the map it is given. A name that went in is cleared; one that did not is marked WH_FAIL_MS. */
export function whFailUpdate (failed, at, asked = [], got = new Set(), now = Date.now()) {
  for (const n of asked) { if (got.has(n)) failed.delete(`${at}|${n}`); else failed.set(`${at}|${n}`, now + WH_FAIL_MS) }
  return failed
}
/** Paper rig 11-17, defect B (two refused cobblestone columns used up both of a deposit's tries; the logs column was never opened):
 *  a column already marked for EVERY name it would be asked is passed without a walk, an open or a try -> bool. Pure. */
export const whAllFailed = (failed, at, asked = [], now = Date.now()) => asked.every(n => (failed?.get?.(`${at}|${n}`) ?? 0) > now)
/** ...and a column that was opened and took nothing (refused at a cap, no room for the name) reads `full` to the run's try count
 *  (towndeposit.mjs tdMoreContainers: a full container is no try) -> the result word. Pure. */
export const whTryResult = (result, column, took) => (column && !took && result === 'none' ? 'full' : result)
/**
 * IS A CONTAINER A DEPOSIT TARGET FOR THIS BAG? -> bool. Pure. `kind` its column kind (null: no column -- any town chest, as before);
 * `names` the item names the bag's plan banks; `kindOf(name)` their column kinds; `full(name)` true when THIS chest has no room for
 * the name. Its own kind's names with room; the overflow any name with room; another kind's column never. The room bank's "a
 * chest is in reach" and its walk target read this (a chest that takes nothing of the bag is no reason to stay, and no place to go).
 */
export function whEligible (kind, names = [], kindOf = () => 'overflow', full = () => false) {
  if (kind == null) return true
  return names.some(n => (kind === 'overflow' || kindOf(n) === kind) && !full(n))
}
/**
 * THE NEXT CHEST TO PLACE for a kind -> [x, y, z] | null. Pure. Only when every standing chest of the kind is full, from a bag
 * carrying two or more (one stays: the full-town recovery's): the lowest missing tier over the kind's columns, in column order, whose
 * cell below stands (a column grows bottom-up, never a floating chest).
 */
export function whPlace (layout, kind, { full = new Set(), standing = () => null, carried = 0 } = {}) {
  if (!(carried >= 2) || kind === 'overflow') return null
  const cols = (layout?.columns ?? []).filter(c => c.kind === kind)
  const up = at => standing(kOf(at)) !== false
  if (cols.some(c => c.chests.some(at => up(at) && !full.has(kOf(at))))) return null
  let best = null
  for (const c of cols) {
    const i = c.chests.findIndex(at => !up(at))
    if (i < 0 || (i > 0 && !up(c.chests[i - 1]))) continue
    if (!best || i < best.i) best = { i, at: c.chests[i] }
  }
  return best ? best.at.slice() : null
}

/**
 * THE ACCESS PROOF over a layout (owner 11-17: "all chests are accessible and easy for the bots to navigate") -> { ok, fails: [text],
 * stats }. Pure, no world: `open(x, y, z)` says whether a cell is AIR in the design (a chest cell is never asked), `doors` the
 * doorway's floor cells [[x, y, z]]. The floor is walked 4-connected from the doors (feet and head open) at the doors' level; then
 *   STAND   every column's stand is on that floor and beside its chests' column;
 *   REACH   every chest of every tier is within WH_REACH of the eye at its stand;
 *   SIGHT   the line from that eye to the chest's front face crosses open cells only (no post, no ceiling, no other chest before it);
 *   LID     a chest has a chest of its own column above it, or an open cell (the top chest's lid: never a solid block);
 *   AISLE   the aisle -- the floor cells that lie in a fully open 3 x 3 -- is one piece, touches every doorway, and every floor
 *           cell is in it or beside it (a stand niche is one cell deep; never a pocket, never a passage under 3 wide).
 * `blocked(x, y, z)` adds obstacles (a test's mutant: a post on a stand, a slab over a column).
 */
export function whAccess ({ layout, doors = [], open = () => false, blocked = () => false, lid = () => false, reach = WH_REACH } = {}) {
  const fails = []
  const rows = whRows(layout)
  const chestAt = new Set(rows.map(r => r.k))
  const air = (x, y, z) => !chestAt.has(`${x},${y},${z}`) && !blocked(x, y, z) && !!open(x, y, z)
  const y0 = doors[0]?.[1] ?? 0
  const walk = (x, z) => air(x, y0, z) && air(x, y0 + 1, z)
  const k2 = (x, z) => `${x},${z}`
  const floor = new Set()
  const q = doors.filter(d => walk(d[0], d[2])).map(d => [d[0], d[2]])
  for (const d of q) floor.add(k2(...d))
  const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]]
  while (q.length) {
    const [x, z] = q.pop()
    for (const [dx, dz] of N4) { const n = k2(x + dx, z + dz); if (!floor.has(n) && walk(x + dx, z + dz)) { floor.add(n); q.push([x + dx, z + dz]) } }
  }
  if (!doors.length || doors.some(d => !floor.has(k2(d[0], d[2])))) fails.push('a doorway cell is not open')
  for (const c of layout?.columns ?? []) {
    const id = `column ${c.col} (${c.kind})`
    if (!Array.isArray(c.stand)) { fails.push(`${id}: no stand`); continue }
    const [sx, sy, sz] = c.stand
    if (sy !== y0 || !floor.has(k2(sx, sz))) { fails.push(`${id}: its stand ${c.stand.join(',')} is not on the floor walked from a doorway`); continue }
    const eye = [sx + 0.5, sy + WH_EYE, sz + 0.5]
    c.chests.forEach((at, i) => {
      const t = `${id} tier ${i + 1}`
      if (Math.abs(at[0] - sx) + Math.abs(at[2] - sz) !== 1) fails.push(`${t}: its stand is not the cell in front of it`)
      if (i > 0 && (at[0] !== c.chests[0][0] || at[2] !== c.chests[0][2] || at[1] !== c.chests[i - 1][1] + 1)) fails.push(`${t}: not on top of the tier below`)
      const ctr = [at[0] + 0.5, at[1] + 0.5, at[2] + 0.5]
      const d = Math.hypot(ctr[0] - eye[0], ctr[1] - eye[1], ctr[2] - eye[2])
      if (!(d <= reach)) fails.push(`${t}: ${d.toFixed(2)} from the eye, past the reach`)
      // the sight line to the chest's FRONT (the face toward the stand: what a click lands on), sampled finely: every cell before
      // the chest's own is open
      const face = [ctr[0] + (sx - at[0]) * 0.5, ctr[1], ctr[2] + (sz - at[2]) * 0.5]
      for (let s = 1; s < 96; s++) {
        const p = [0, 1, 2].map(j => Math.floor(eye[j] + (face[j] - eye[j]) * s / 96))
        if (p[0] === at[0] && p[1] === at[1] && p[2] === at[2]) break
        if (!air(...p)) { fails.push(`${t}: ${p.join(',')} stands between the eye and the chest`); break }
      }
      const top = i === c.chests.length - 1
      // `lid(x, y, z)`: a block there that stops no chest opening (glass, leaves, a slab: lidrule.mjs chestLidBlocked's own rule -- Paper
      // rig 11-17: a chest under glass opened 11 of 11)
      if (top ? !(air(at[0], at[1] + 1, at[2]) || (!blocked(at[0], at[1] + 1, at[2]) && lid(at[0], at[1] + 1, at[2]))) : !chestAt.has(`${at[0]},${at[1] + 1},${at[2]}`)) fails.push(`${t}: a solid block is over it (a chest opens under a chest or under an open cell)`)
    })
  }
  // THE AISLE: the floor cells inside a fully open 3 x 3
  const aisle = new Set()
  for (const f of floor) {
    const [x, z] = f.split(',').map(Number)
    let all = true
    for (let a = 0; a < 3 && all; a++) for (let b = 0; b < 3 && all; b++) if (!floor.has(k2(x + a, z + b))) all = false
    if (all) for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) aisle.add(k2(x + a, z + b))
  }
  const first = [...aisle][0]
  if (!first) fails.push('there is no aisle 3 wide')
  else {
    const seen = new Set([first]), qa = [first]
    while (qa.length) { const [x, z] = qa.pop().split(',').map(Number); for (const [dx, dz] of N4) { const n = k2(x + dx, z + dz); if (aisle.has(n) && !seen.has(n)) { seen.add(n); qa.push(n) } } }
    if (seen.size !== aisle.size) fails.push('the aisle is in two pieces')
  }
  const near = (x, z) => aisle.has(k2(x, z)) || N4.some(([dx, dz]) => aisle.has(k2(x + dx, z + dz)))
  for (const f of floor) { const [x, z] = f.split(',').map(Number); if (!near(x, z)) fails.push(`floor cell ${f} is a pocket (not in the 3-wide aisle, not beside it)`) }
  for (const d of doors) if (!near(d[0], d[2])) fails.push(`the aisle does not reach the doorway at ${d[0]},${d[2]}`)
  return { ok: fails.length === 0, fails, stats: { columns: layout?.columns?.length ?? 0, chests: rows.length, slots: rows.length * 27, floor: floor.size, aisle: aisle.size, niches: floor.size - aisle.size } }
}
/**
 * THE OLD HALL'S DESIGN for the proof, in blueprint cells (x = u, z = v; blueprints/storehub@1.json: the interior u 2..16, v 2..8,
 * two high under a plank ceiling; the doorway u 8..10 in the v 1 wall; four lights on the long walls) -> { layout, doors, open }. Pure.
 */
export function whHallDesign () {
  const cells = Object.keys(WH_HALL).map(k => { const [u, v] = k.split(',').map(Number); return { u, v } })
  const chests = cells.map(({ u, v }) => ({ at: [u, 1, v], stand: v === 8 ? [u, 1, 7] : v === 2 ? [u, 1, 3] : u === 2 ? [3, 1, v] : [15, 1, v] }))
  const lights = new Set(['5,8', '13,8', '5,2', '13,2'])
  const open = (x, y, z) => (y === 1 || y === 2) && ((x >= 2 && x <= 16 && z >= 2 && z <= 8 && !(y === 1 && lights.has(`${x},${z}`))) || (z === 1 && x >= 8 && x <= 10))
  return { layout: whHallLayout(chests, cells), doors: [[8, 1, 1], [9, 1, 1], [10, 1, 1]], open }
}
/**
 * THE TARGETS THAT TRAVEL WITH OWED CARGO -> { name: { name, to, section, why } }. Pure. ONLY a STAGE move's (Codex r3: saving every
 * move's target changed the base clerk -- after an interrupted take planned for a second home, the recovery tried that home first
 * where release 2 works the order out again). No stage (WAREHOUSE off, or no layout: clerkMoves never stages): nothing is saved.
 */
export const whCargoRoutes = (moves = []) => Object.fromEntries((moves ?? []).filter(m => m?.why === 'stage' && m.to && m.to !== 'well').map(m => [m.name, { name: m.name, to: m.to, section: m.section, why: m.why }]))
/** A column's wall-sign text (at most 15 characters a line: Paper rig 11-17 cut "COBBLED DEEPSLA"). */
export const WH_LABELS = Object.freeze({ cobblestone: ['COBBLESTONE'], cobbled_deepslate: ['COBBLED', 'DEEPSLATE'], dirt: ['DIRT'], stone: ['STONE'], logs: ['LOGS'], planks: ['PLANKS', 'sticks'], gravel: ['GRAVEL', 'flint'], sand: ['SAND'], deepslate: ['DEEPSLATE', 'tuff'], stones: ['ANDESITE', 'diorite', 'granite'], parts: ['BUILDING', 'PARTS'], valuables: ['VALUABLES', 'ores, ingots', 'coal'], tools: ['TOOLS'], farm: ['FARM', 'seeds, food', 'saplings'], overflow: ['OVERFLOW'] })
export const whLabel = kind => (WH_LABELS[kind] ?? [String(kind ?? '').toUpperCase().replace(/_/g, ' ').slice(0, 15)]).map(l => l.slice(0, 15))
/** The pool's record of the columns (the LABEL: which chest is whose) -> a plain object. Pure. */
export const whRecord = (layout, { now = Date.now() } = {}) => ({ v: 1, id: layout?.id ?? null, t: now, columns: (layout?.columns ?? []).map(c => ({ col: c.col, kind: c.kind, section: c.section, chests: c.chests, stand: c.stand })) })
/** `warehouse` licence row detail (once per spawn). Pure. */
export function warehouseModeDetail (on = WAREHOUSE.on, layout = null) {
  const a = whAccess(whHallDesign())
  return `on=${on ? 1 : 0} mode=${WAREHOUSE.mode} v=1 layout=${layout?.id ?? '-'} columns=${layout?.columns?.length ?? 0} chests=${whRows(layout).length} hall_access=${a.ok ? 'ok' : `FAILS:${a.fails.length}`} aisle=${a.stats.aisle} niches=${a.stats.niches}`
}
