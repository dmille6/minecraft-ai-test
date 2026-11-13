// LEAFFELL-01SHOW (showcase, 11-12; OWNER: "a stuck cell must not freeze a building"): A NATURAL LEAF NEVER NEEDS A STAND -- ITS TRUNK DOES.
//
// THE CASE (LIVE showcase da8db7fe, 11-12): natural tree leaves no stand reaches held whole buildings for good.
//   1. the storage hall's re-roof: `project=reroof outcome=no_site why=storehub: the added roof is not proven (clear_unreached 13/29 first
//      spruce_leaves@11,74,-53)` on every try (reroof.mjs reroofProve: EVERY listed dig must have a dig stand, a leaf included);
//   2. the styled buildings' siting (sitecanopy.mjs cellClearsHook): a candidate one of whose in-cell leaves the reach test cannot dig
//      fails `leaves_unreached`;
//   3. the tower: 9 listed leaf clears at x=49 inside the protected village zone -- every visit walked to each one, the dig was refused
//      (`_protect_zone_refused op=dig zone=village-taiga-6_1`, 243 rows), nothing was recorded, the next visit walked there again.
//
// THE RULE. The server decays a leaf (persistent=false) once no log is within 6 leaf steps of it. So for a leaf no stand reaches the
// proof asks a different question: WHAT HOLDS IT? (leafSupport: every log within 6 steps through leaves, any species.)
//   - every holding log is a listed clear a stand reaches (or there is none): the leaf is DECAYING -- no blocker, marked `decay: 1`
//   - a holding log is a natural tree nobody owns: the whole tree is listed (kind `remains`: floating, or rooted on the building itself --
//     no sapling owed, reroof-03's rule; kind `tree`: rooted in the ground -- its saplings are owed and planted first, B4) and the reach
//     test runs again over the longer list: FELL FIRST
//   - anything else keeps the old answer, and the row names the leaf and the reason once: a placed leaf (persistent), a log that is a
//     record's cell (a post holds its leaves for good), a stripped or placed log, a trunk in a protected zone or a reservation, a trunk
//     no stand reaches, a 2x2 tree, an unread cell near it
// THE VISIT (buildrun.mjs runVisit): a segment whose only held cells hold a listed decaying leaf WAITS (`leaf_decay`: a named stop,
// never stuck_on_cell, never the 6-hour back-off) while its trunk is listed or down, at most LEAF_WAIT_MS; a listed clear the
// protected-zone rule refuses is set aside for the visit before any walk (`clear_zoned`, one row).
// LEAFFELL=off|0|false|no is the rollback: every proof, siting and visit exactly as before.
import { treeOf } from './buildsite.mjs'

const nm = b => String(b?.name ?? '').replace(/\[.*\]$/, '')
const k = a => a.join(',')
export const leafFellOn = (env = typeof process !== 'undefined' ? process.env : {}) => !/^(off|0|false|no)$/i.test(String(env?.LEAFFELL ?? '').trim())
export const LEAFFELL_ON = leafFellOn()

export const LEAF_DIST = 6                  // vanilla: a leaf whose distance reads 7 (no log within 6 steps through leaves) decays
export const LEAFFELL_MAX_LOGS = 48         // logs one fell-first plan may add (a spruce: 6 to 12; a giant is no plan)
export const LEAFFELL_ROUNDS = 3            // reach tests a plan may ask for after the first
export const LEAF_WAIT_MS = 45 * 60_000     // how long a cell waits on one decaying leaf (vanilla decay: minutes once the trunk is down)
export const LEAF_FORGET_MS = 6 * 60 * 60_000   // a spent wait is forgotten after this (the world changed: a fresh wait)
export const LEAF_ROW_MS = 30 * 60_000      // one row per decision and cell this often at most
const LEAVES = /_leaves$/
// every block the server's #logs tag names holds leaves: a tree's log or wood, stripped ones, the nether stems (a bamboo block too, on
// the safe side: a block wrongly read as holding keeps the old answer)
const HOLDS = /_(log|wood)$|^(stripped_)?(crimson|warped)_(stem|hyphae)$|^(stripped_)?bamboo_block$/
// a tree a sapling replaces (buildsite.mjs LOG): never a stripped log (someone placed it)
const TREE_LOG = /^(oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak)_(log|wood)$/
const SAPLING_OF = { oak: 'oak_sapling', spruce: 'spruce_sapling', birch: 'birch_sapling', jungle: 'jungle_sapling', acacia: 'acacia_sapling', dark_oak: 'dark_oak_sapling', mangrove: 'mangrove_propagule', cherry: 'cherry_sapling', pale_oak: 'pale_oak_sapling' }
const NEEDS_2X2 = new Set(['dark_oak', 'pale_oak'])
const AIR = /^(air|cave_air)$/
const N6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
export const LEAF_REMAINS = 'remains'       // reroof.mjs REROOF_REMAINS: a log whose felling owes no sapling
export const LEAF_TREE_ID0 = 9000           // the `tree` tags of the trees a plan adds (its logs and its replants carry the same: buildrun.mjs treeReplanted)

/** A reader's block is a NATURAL leaf (persistent false; unread properties: never). Pure. */
export function naturalLeaf (b) {
  if (!b || !LEAVES.test(nm(b))) return false
  const p = b.props
  return p?.persistent === false || p?.persistent === 'false'
}

/**
 * WHAT HOLDS A LEAF -> { logs: [[x, y, z]], unknown }. Pure. The server's own rule: a leaf's distance is 1 beside a log, else one more
 * than its nearest leaf neighbour's (any leaves, a placed one too: each carries the distance on); at 7 a natural leaf decays. So: every
 * log-class block (HOLDS, or a cell of `planned`: a log the build is about to place) within `dist` steps through 6-neighbour leaves.
 * `unknown`: a cell on the way could not be read (an unloaded chunk): nothing is concluded from it.
 */
export function leafSupport (read, at, { dist = LEAF_DIST, planned = null } = {}) {
  const seen = new Set([k(at)]), logs = []
  let frontier = [at], unknown = false
  for (let d = 1; d <= dist && frontier.length; d++) {
    const next = []
    for (const [x, y, z] of frontier) for (const [dx, dy, dz] of N6) {
      const q = [x + dx, y + dy, z + dz], key = k(q)
      if (seen.has(key)) continue
      seen.add(key)
      const b = read(...q)
      if (!b) { unknown = true; continue }
      if (HOLDS.test(nm(b)) || planned?.has(key)) logs.push(q)
      else if (d < dist && LEAVES.test(nm(b))) next.push(q)
    }
    frontier = next
  }
  return { logs, unknown }
}

/**
 * THE FELL-FIRST PLAN for the digs no stand reaches -> { ok, decay: [[x, y, z]], fell: [{ at, name, kind }], trees: [{ base, species,
 * sapling, logs }], blockers: [{ at, name, why }] }. Pure.
 *   clear      the listed digs ({ at, name, kind }); unreached  the cells of it the reach test found no stand for
 *   own        Set of the building's own cell keys (standing and to place); recordAt(x, y, z) -> any record holds the cell
 *   closed(x, y, z) -> truthy when a dig there is refused or owed to someone else (a protected zone, a reservation)
 *   planned    Set of keys where the build will place a log-class block (it will hold the leaves round it)
 *   rooted     Set of the STANDING building's cell keys: a tree rooted on one (a sapling that took on its roof) owes no sapling
 * An unreached cell is DECAYING when it reads a natural leaf and every log that holds it (leafSupport) is a listed dig a stand reaches,
 * or one of a tree this plan adds (`fell`): the whole tree by buildsite.mjs treeOf, never a record's cell, never closed, never more
 * than `maxLogs` (tagged `tree`: treeId0 on); kind `remains` when it owes no sapling (every base over air, or on a `rooted` cell), else kind
 * `tree` with one sapling owed per base (buildsite.mjs screenSite's rule; a 2x2 trunk refuses). ok: no blocker. `fell` empty and ok:
 * the list as it stands is enough. Every blocker names its cell and why (the first log that keeps it).
 */
export function leafFellPlan (read, clear = [], unreached = [], { own = new Set(), rooted = null, recordAt = () => null, closed = () => null, planned = null, maxLogs = LEAFFELL_MAX_LOGS, treeId0 = LEAF_TREE_ID0 } = {}) {
  const listed = new Map(clear.filter(c => Array.isArray(c?.at)).map(c => [k(c.at), c]))
  const un = new Set(unreached.map(k))
  const decay = [], blockers = [], fell = new Map(), trees = [], verdict = new Map()
  let nTrees = 0
  const isLogNow = q => HOLDS.test(nm(read(...q)))
  // one tree, judged once: every log of it carries the verdict
  const judge = log => {
    const lk = k(log)
    if (verdict.has(lk)) return verdict.get(lk)
    const set = (logs, v) => { for (const q of logs) verdict.set(k(q), v); verdict.set(lk, v); return v }
    if (own.has(lk) || planned?.has(lk) || recordAt(...log)) return set([], { ok: false, why: 'record_log' })
    const name = nm(read(...log))
    if (!TREE_LOG.test(name)) return set([], { ok: false, why: 'placed_log' })
    const logs = treeOf(read, log, maxLogs)
    if (logs.length + fell.size > maxLogs) return set(logs, { ok: false, why: 'tree_too_big' })
    if (logs.some(q => own.has(k(q)) || recordAt(...q))) return set(logs, { ok: false, why: 'record_log' })
    if (logs.some(q => closed(...q))) return set(logs, { ok: false, why: 'trunk_closed' })
    const below = ([x, y, z]) => read(x, y - 1, z)
    const bases = logs.filter(q => { const n = nm(below(q)); return !HOLDS.test(n) && !LEAVES.test(n) })
    if (bases.some(q => !below(q))) return set(logs, { ok: false, why: 'unread_near' })
    // no sapling owed: nothing of it stands on ground (a felled tree's remains over air), or it is rooted on the building's own cells
    const owes = bases.filter(q => !AIR.test(nm(below(q))) && !rooted?.has(k([q[0], q[1] - 1, q[2]])))
    const mine = []
    for (const b of owes) {
      const species = TREE_LOG.exec(nm(read(...b)))?.[1] ?? null
      if (!species || NEEDS_2X2.has(species) || owes.some(o => o !== b && Math.abs(o[1] - b[1]) <= 3 && Math.abs(o[0] - b[0]) + Math.abs(o[2] - b[2]) === 1)) return set(logs, { ok: false, why: 'tree_2x2' })
      mine.push({ base: b.slice(), species, sapling: SAPLING_OF[species], logs: logs.length })
    }
    const kind = owes.length ? 'tree' : LEAF_REMAINS
    // a tree that owes saplings is TAGGED (its logs and its saplings: `tree`): fellfirst-01's question -- is ITS sapling kind absent
    // everywhere? -- is asked of its own replants (buildrun.mjs treeOwed), never of an older replant of the same record
    const tag = owes.length ? { tree: treeId0 + nTrees++ } : {}
    for (const t of mine) Object.assign(t, tag)
    for (const q of logs) if (!listed.has(k(q))) fell.set(k(q), { at: q.slice(), name: nm(read(...q)), kind, ...tag })
    trees.push(...mine)
    return set(logs, { ok: true })
  }
  for (const at of unreached) {
    const b = read(...at), name = b ? nm(b) : (listed.get(k(at))?.name ?? 'unknown')
    if (!b) { blockers.push({ at: at.slice(), name, why: 'unread' }); continue }
    if (!LEAVES.test(name)) { blockers.push({ at: at.slice(), name, why: isLogNow(at) ? 'trunk_unreached' : 'not_leaves' }); continue }
    if (!naturalLeaf(b)) { blockers.push({ at: at.slice(), name, why: 'placed_leaves' }); continue }
    const sup = leafSupport(read, at, { planned })
    if (sup.unknown) { blockers.push({ at: at.slice(), name, why: 'unread_near' }); continue }
    let why = null
    for (const lg of sup.logs) {
      const lk = k(lg)
      // a listed log (still the block listed) a stand reaches comes down; one no stand reaches holds the leaf
      if (listed.has(lk) && listed.get(lk).name === nm(read(...lg)) && !planned?.has(lk)) { if (un.has(lk)) { why = `trunk_unreached ${lk}`; break } continue }
      const v = judge(lg)
      if (!v.ok) { why = `${v.why} ${lk}`; break }
    }
    if (why) blockers.push({ at: at.slice(), name, why }); else decay.push(at.slice())
  }
  // a refused plan lists nothing: no tree is felled for a leaf that stays a blocker beside it
  if (blockers.length) return { ok: false, decay: [], fell: [], trees: [], blockers }
  return { ok: true, decay, fell: [...fell.values()], trees, blockers }
}

const ORDER = (a, b) => a.at[1] - b.at[1] || a.at[0] - b.at[0] || a.at[2] - b.at[2]
/** The clear list with the decaying leaves marked (`decay: 1`: the visit waits on such a cell instead of calling it blocked). Pure. */
export function markDecay (clear = [], decay = []) {
  const keys = new Set(decay.map(k))
  return clear.map(c => (keys.has(k(c.at)) && c.decay !== 1 ? { ...c, decay: 1 } : c))
}
/**
 * THE REACH TEST WITH FELL-FIRST, as steps -> { ok, clear, decay, fell, trees, blockers, rounds }. `reachSteps(list)` the caller's own
 * reach test as a generator (-> { ok, unreached }: a turn of the event loop after every walk); `rc` its answer for `clear`. While
 * digs stay unreached: plan (leafFellPlan), add the trees it names, test again -- at most LEAFFELL_ROUNDS. ok: every dig is reached
 * or is a decaying leaf. The first blocker names the leaf that keeps the old answer.
 */
export function * leafFellSteps (read, clear = [], rc, reachSteps, opts = {}) {
  let list = clear, cur = rc
  const fell = [], trees = []
  for (let i = 0; i <= LEAFFELL_ROUNDS; i++) {
    if (cur?.ok) return { ok: true, clear: list, decay: [], fell, trees, blockers: [], rounds: i }
    const pl = leafFellPlan(read, list, cur?.unreached ?? [], { ...opts, treeId0: (opts.treeId0 ?? LEAF_TREE_ID0) + new Set(trees.map(q => q.tree)).size })
    if (!pl.ok) return { ok: false, clear, decay: [], fell: [], trees: [], blockers: pl.blockers, rounds: i }
    if (!pl.fell.length) return { ok: true, clear: markDecay(list, pl.decay), decay: pl.decay, fell, trees, blockers: [], rounds: i }
    if (i === LEAFFELL_ROUNDS) break
    fell.push(...pl.fell); trees.push(...pl.trees)
    list = [...list, ...pl.fell].sort(ORDER)
    cur = yield * reachSteps(list)
  }
  return { ok: false, clear, decay: [], fell: [], trees: [], blockers: [{ at: (cur?.unreached ?? [[]])[0], name: 'unknown', why: 'rounds_spent' }], rounds: LEAFFELL_ROUNDS }
}
/** A blocker as the row carries it: `<why> <name>@x,y,z`. Pure. */
export const leafBlockerText = b => (b ? `${String(b.why).replace(/\s+/g, ':')} ${b.name}@${(b.at ?? []).join(',')}` : '')

/**
 * THE VISIT'S QUESTION (buildrun.mjs runVisit): DOES THIS HELD CELL WAIT ON A DECAYING LEAF? -> { wait, why }. Pure but for `mem` (a Map
 * key -> ms the first wait began; the caller's, kept across visits). It waits when the cell holds a natural leaf the record lists as
 * decaying (`listed(at)` -> the clear entry: `decay: 1`, the same name) and nothing but listed logs still holds it (`trunk_listed`: the
 * visit's clears fell them) or nothing does (`trunk_down`: the server takes it within minutes) -- and only for LEAF_WAIT_MS from the
 * first wait: after that the cell is what it was before (blocked), until LEAF_FORGET_MS have passed. A log that is no listed clear
 * (a tree grown since, a post) ends the wait at once.
 */
export function leafWait (read, at, { listed = () => null, mem = null, memKey = '', now = Date.now(), waitMs = LEAF_WAIT_MS, forgetMs = LEAF_FORGET_MS } = {}) {
  const b = read(...at)
  if (!naturalLeaf(b)) return { wait: false, why: 'no_natural_leaf' }
  const c = listed(at)
  if (!c || c.decay !== 1 || c.name !== nm(b)) return { wait: false, why: 'not_listed_decay' }
  const sup = leafSupport(read, at)
  if (sup.unknown) return { wait: false, why: 'unread_near' }
  for (const lg of sup.logs) { const l = listed(lg); if (!l || l.name !== nm(read(...lg))) return { wait: false, why: `held_by ${k(lg)}` } }
  if (mem) {
    const key = `${memKey}|${k(at)}`
    let first = mem.get(key)
    if (first == null || now - first >= forgetMs) { first = now; mem.set(key, first) }
    if (now - first >= waitMs) return { wait: false, why: 'wait_spent' }
  }
  return { wait: true, why: sup.logs.length ? 'trunk_listed' : 'trunk_down' }
}
/**
 * DOES A SEGMENT WAIT ON ITS LEAVES? -> { wait, cells: [[x, y, z]], why }. Pure. `held` the open cells that still hold a block (not
 * clear); it waits only when there is one and EVERY one of them waits (`waits(at)` -> leafWait's answer): one cell held by anything
 * else and the segment is what it was (blocked).
 */
export function segLeafWait (held = [], waits = () => ({ wait: false })) {
  if (!held.length) return { wait: false, cells: [], why: 'none_held' }
  let why = null
  for (const at of held) { const w = waits(at); if (!w?.wait) return { wait: false, cells: [], why: w?.why ?? 'held' }; why ??= w.why }
  return { wait: true, cells: held.map(a => a.slice()), why }
}
/** ONE ROW PER KEY EVERY `ms` -> bool (true: write it now). `mem` a Map key -> ms. */
export function rowDue (mem, key, now = Date.now(), ms = LEAF_ROW_MS) {
  if (!mem) return true
  const at = mem.get(key)
  if (at != null && now - at < ms) return false
  mem.set(key, now)
  return true
}
