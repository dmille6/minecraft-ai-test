// WHSITE-01 (bagfix-03show; OWNER 11-17): THE NEW STOREHOUSE'S GROUND. "can we dismantle the current useless storeroom and build this in
// its place?" -- a purpose-built storehouse (a cross of four wings) on a site the owner picked, just outside the east wall: forest floor,
// ~350 tree columns, ~370 blocks of levelling. This is the project's FIRST generation: the ground only -- fell and level the core box,
// and hold the growth box (all four wings extended) for it. The body (pad, walls, roof, fit-out) is a later generation of the SAME
// record: plot `warehouse` throughout (the timelapse camera is keyed to it).
//
// PURE: the switch and the site, the record and how a survey grows it, the visit's views, the quadrants. skills.mjs reads the world
// (tidy.mjs plotPrep: the trees, their felling stairs, the level's cuts and fills; replantCells: the saplings owed) and runs the visit.
//
// THE SITE IS THE SWITCH (no coordinates in the code: any world, any site):
//   WAREHOUSE_SITE=<core>/<grow>/<floor>   core and grow "x0,z0,x1,z1" (grow holds core), floor the ground's top block level
//   e.g. WAREHOUSE_SITE=38,-51,62,-27/38,-58,78,-18/68.  Unset: the town's site file decides (whSiteOfSeed: its `warehouse` key; none: no
//   project, release 2 exactly).  off | 0 | false | no: no project, whatever the file says.  Unreadable: no project.
//
// THE RECORD (the showcase's read judges every placement against the HEAD record's `cells` and every dig against its `clear`: so the
// record only ever GROWS -- a survey appends, nothing is taken out, and the body's generation carries all of it):
//   cells    the level's fills (role `fill`) and the felling stairs (role `stand`), ALL in the one segment `prep` (one bot places at
//            a time: two bots on neighbouring segments is what the read's lease rule faults)
//   clear    the trees' logs (kind `tree`, `tree` its index), the leaves over the stairs (`leaves`), the level's cuts (`cut`), and
//            each stair cell again (`stand`: dug once its tree is down) -- each with its quadrant `q`
//   replant  the saplings owed, outside the growth box (`tree` the index each is owed for)
//   zones    the growth box, every height: nothing else is sited there
// THE WORK: clears are dug under a lease PER QUADRANT (`seg-clear-NE|NW|SE|SW`, buildrun.mjs `clearPart`), so four bots fell at once.
// PHASES: `fell` while a listed log stands (the stairs go up, the trees come down), then `level` (the stairs come down, the cuts, the
// fills), then `survey` again (the ground the trees stood on, what was unloaded before): a survey that finds nothing new completes it.

const isOff = v => ['', 'off', '0', 'false', 'no'].includes(String(v ?? '').trim().toLowerCase())
export const WHS_PLOT = 'warehouse'
export const WHS_BLUEPRINT = 'warehouse@0'
export const WHS_BUILDERS = 6
export const WHS_SEG = 'prep'
export const WHS_QUADS = Object.freeze(['NE', 'NW', 'SE', 'SW'])
/** Surveys a record may take (each appends; the last one's findings are worked, then it completes whatever is left). */
export const WHS_SURVEYS = 8
/** The level's and the stairs' bounds for tidy.mjs plotPrep (a forest floor steps more than a town plot; the stepwell's 5-step stair). */
export const WHS_PREP = Object.freeze({ cutMax: 6, fillMax: 6, reachUp: 5, platMax: 5 })
/** The visit's palette: a fill is dirt (any solid block there is done: grass grows on it), a stair cell cobblestone. */
// THE FILL IS WHATEVER GROUND THE BAG HOLDS (rig ask 11-17: "what happens when the town has no dirt"): the level's own cuts come first
// in a visit and their dirt and stone go straight into the fills (cut and fill roughly balance); with none, the cobblestone every bot
// carries. A fill is under the storehouse's floor: any solid block there is done.
export const WHS_FILLS = Object.freeze(['dirt', 'cobblestone', 'cobbled_deepslate', 'stone', 'andesite', 'diorite', 'granite', 'coarse_dirt', 'gravel'])
export const WHS_PALETTE = Object.freeze({ fill: [...WHS_FILLS, '*solid'], stand: ['cobblestone'] })

const INT = /^-?\d+$/
const box4 = s => { const p = String(s ?? '').split(',').map(v => v.trim()); if (p.length !== 4 || !p.every(v => INT.test(v))) return null; const a = p.map(Number); return a[0] <= a[2] && a[1] <= a[3] ? a : null }
/** THE SITE of the switch -> { core, grow, floor } | null (off, or unreadable: a site that cannot be read is never guessed). Pure. */
export function whSiteOf (env = {}) {
  const v = env?.WAREHOUSE_SITE
  if (isOff(v)) return null
  const [c, g, f, ...rest] = String(v).split('/')
  const core = box4(c), grow = box4(g), floor = INT.test(String(f ?? '').trim()) ? Number(String(f).trim()) : NaN
  if (!core || !grow || rest.length || !Number.isInteger(floor) || floor < -60 || floor > 300) return null
  if (core[0] < grow[0] || core[1] < grow[1] || core[2] > grow[2] || core[3] > grow[3]) return null
  if (core[2] - core[0] > 63 || core[3] - core[1] > 63 || grow[2] - grow[0] > 127 || grow[3] - grow[1] > 127) return null
  return { core, grow, floor }
}
/** Is the switch SET to off (a forced "no project", whatever the town's site file says)? An unset or empty switch is not. Pure. */
export const whSiteEnvOff = (env = {}) => { const v = String(env?.WAREHOUSE_SITE ?? '').trim().toLowerCase(); return ['off', '0', 'false', 'no'].includes(v) }
/**
 * THE SITE OF THE TOWN'S SITE FILE (rc2: the showcase's environment is a fixed list -- the site is a key of `town-site.json`, the
 * file townplan.mjs parseSeed reads) -> { core, grow, floor } | null. Pure. `json.warehouse` = { core: [x0, z0, x1, z1], grow: [...],
 * floor }; every number a safe integer, read by whSiteOf's own rules. Absent, malformed, or a file that names ANOTHER home: null (no
 * project) -- and nothing else of the file is touched (parseSeed never reads this key and ignores what it does not know).
 */
export function whSiteOfSeed (json, home = null) {
  try {
    const w = json?.warehouse
    if (!w || typeof w !== 'object' || Array.isArray(w)) return null
    const h = Array.isArray(json.home) ? { x: json.home[0], y: json.home[1], z: json.home[2] } : json.home
    if (home && h && (h.x !== home.x || h.y !== home.y || h.z !== home.z)) return null
    const ints = a => Array.isArray(a) && a.length === 4 && a.every(Number.isSafeInteger)
    if (!ints(w.core) || !ints(w.grow) || !Number.isSafeInteger(w.floor)) return null
    return whSiteOf({ WAREHOUSE_SITE: `${w.core.join(',')}/${w.grow.join(',')}/${w.floor}` })
  } catch { return null }
}
/** This process's site: the environment's here (the pure default); whsitefile.mjs replaces it at load with the environment's or the
 *  town file's (shop.mjs imports that module before it builds its project list). */
export const WHSITE = { site: whSiteOf(typeof process !== 'undefined' ? process.env : {}), get on () { return !!this.site } }
/** A column's quadrant in a box -> 'NE' | 'NW' | 'SE' | 'SW' (north is -z, east +x; the middle column and row go east and south). Pure. */
export function quadOf (box, x, z) {
  const mx = (box[0] + box[2]) / 2, mz = (box[1] + box[3]) / 2
  return `${z < mz ? 'N' : 'S'}${x >= mx ? 'E' : 'W'}`
}
const kOf = a => `${a[0]},${a[1]},${a[2]}`
/** THE FIRST GENERATION -> the record: the box, the reservation, nothing to do yet (the first survey fills it). Pure. */
export function whSiteBase (site, { home = null, now = Date.now(), by = null } = {}) {
  const [gx0, gz0, gx1, gz1] = site.grow
  return {
    v: 1, blueprint: WHS_BLUEPRINT, plot: WHS_PLOT, home, state: 'open', builders_max: WHS_BUILDERS,
    box: site.core.slice(), grow: site.grow.slice(), s: site.floor, floor: site.floor,
    zones: [{ box: [gx0, -64, gz0, gx1, 320, gz1], why: `project:${WHS_PLOT}` }],
    cells: [], clear: [], replant: [], trees: [], kept: {}, surveys: 0,
    segments: [{ seg: WHS_SEG, layer: 0, deps: [] }], sitedAt: now, by,
  }
}
/**
 * A SURVEY'S FINDINGS ADDED -> the next record, with `added` = { trees, logs, stands, cuts, fills, replants } | null (not this
 * project's record). Pure. `pp` tidy.mjs plotPrep's answer for the core box at the record's floor; `rp` replantCells' cells for
 * pp.trees, in order (fewer than the trees: the rest owe none). Only entries the record does not list yet are appended (a cell
 * is listed once per list); a tree's index is its place in the record's `trees`. Nothing is ever removed. `kept`: what the survey
 * left standing and why (a tree too tall for a stair, ground that is no levelling ground). `read` false: the box was not loaded
 * (the caller publishes nothing and never completes on it).
 */
export function whSiteAdd (rec, pp, rp = [], { now = Date.now() } = {}) {
  if (!rec || rec.plot !== WHS_PLOT || !Array.isArray(rec.cells) || !Array.isArray(rec.clear)) return null
  const inClear = new Set(rec.clear.map(c => kOf(c.at))), inCells = new Set(rec.cells.map(c => kOf(c.at)))
  const q = at => quadOf(rec.box, at[0], at[2])
  const cells = [], clear = [], trees = [], replant = []
  const added = { trees: 0, logs: 0, stands: 0, cuts: 0, fills: 0, replants: 0 }
  const idxOf = new Map()   // the survey's tree index -> the record's
  const known = new Set((rec.trees ?? []).map(t => kOf(t.base)))
  ;(pp?.trees ?? []).forEach((t, i) => {
    if (known.has(kOf(t.base))) return
    idxOf.set(i, (rec.trees ?? []).length + trees.length)
    trees.push({ base: t.base, name: t.name, top: t.top, q: q(t.base) })
    added.trees++
    const r = rp[i]
    if (r?.cell) { replant.push({ ...r, cell: r.cell.slice(), tree: idxOf.get(i) }); added.replants++ }
  })
  const push = e => { const k = kOf(e.at); if (inClear.has(k)) return false; inClear.add(k); clear.push(e); return true }
  for (const c of pp?.clear ?? []) {
    if (c.kind === 'tree') { if (idxOf.has(c.tree) && push({ at: c.at, kind: 'tree', name: c.name, tree: idxOf.get(c.tree), q: q(trees[idxOf.get(c.tree) - (rec.trees ?? []).length].base) })) added.logs++ } else push({ at: c.at, kind: 'leaves', name: c.name, q: q(c.at) })
  }
  for (const p of pp?.platforms ?? []) {
    if (!idxOf.has(p.tree)) continue
    const ti = idxOf.get(p.tree), tq = trees[ti - (rec.trees ?? []).length].q
    for (const at of p.cells) {
      const k = kOf(at)
      if (inCells.has(k) || inClear.has(k)) continue
      inCells.add(k); cells.push({ at, role: 'stand', seg: WHS_SEG, tree: ti })
      inClear.add(k); clear.push({ at, kind: 'stand', name: WHS_PALETTE.stand[0], tree: ti, q: tq })
      added.stands++
    }
  }
  for (const c of pp?.cut ?? []) if (push({ at: c.at, kind: 'cut', name: c.name, q: q(c.at) })) added.cuts++
  for (const c of pp?.fill ?? []) { const k = kOf(c.at); if (inCells.has(k) || inClear.has(k)) continue; inCells.add(k); cells.push({ at: c.at, role: 'fill', seg: WHS_SEG }); added.fills++ }
  const kept = { ...(rec.kept ?? {}) }
  for (const [k, v] of Object.entries(pp?.skipped ?? {})) if (v > 0) kept[k] = v
  // `read`: the survey READ the box (plotPrep summarised it: its floor). An unloaded box finds nothing -- that is never "nothing left"
  const read = (pp?.plots ?? []).some(x => Number.isFinite(x?.floor))
  return { read, rec: { ...rec, cells: [...rec.cells, ...cells], clear: [...rec.clear, ...clear], trees: [...(rec.trees ?? []), ...trees], replant: [...(rec.replant ?? []), ...replant], kept, surveys: (Number(rec.surveys) || 0) + 1, surveyAt: now }, added }
}
/**
 * WHAT A SURVEY PUBLISHES ONTO THE HEAD (Codex r2 blocker G: a bot that surveyed an OLD record and published its own copy took another
 * bot's canopy clears -- and digs already made -- off the head) -> the next record | null. Pure. The findings are ADDED TO `cur`, the
 * head as it stands now (whSiteAdd is a merge: everything `cur` lists stays); a survey that finds nothing new completes the ground only
 * when no other survey was published since it looked (`surveys0`: the count it saw) and the box was read.
 */
export function whSurveyPublish (cur, pp, rp = [], { surveys0 = 0, now = Date.now() } = {}) {
  if (!cur || cur.plot !== WHS_PLOT || cur.blueprint !== WHS_BLUEPRINT) return null
  const a = whSiteAdd(cur, pp, rp, { now })
  if (!a || !a.read) return null
  if (Object.values(a.added).some(v => v > 0)) return a.rec
  if ((Number(cur.surveys) || 0) !== surveys0) return null
  return { ...cur, surveys: surveys0 + 1, kept: a.rec.kept, prepDone: now, structure_complete: true, state: 'complete', completeAt: now }
}
const LOG = /_(log|wood)$/
const nm = b => String(b?.name ?? '').replace(/\[.*\]$/, '')
const solid = b => !!b && b.boundingBox === 'block'
/**
 * WHERE THE GROUND WORK STANDS -> { phase: 'fell' | 'level' | 'survey' | 'done' | 'unread', logs, stands, cuts, fills, byQuad }. Pure
 * over `read`. logs: listed logs standing; stands: stair cells standing whose tree is down; cuts: listed cuts standing (their block
 * still there); fills: fill cells open; byQuad: { q: clears left in the phase } (the quadrant a bot takes). An unread listed cell:
 * 'unread' (the bot is not at the site: the visit walks there). `survey`: nothing listed is left and a survey may still be taken.
 */
export function whPhase (read, rec, { surveys = WHS_SURVEYS } = {}) {
  const out = { phase: 'unread', logs: 0, stands: 0, cuts: 0, fills: 0, byQuad: {} }
  const treeUp = new Set()
  for (const c of rec?.clear ?? []) {
    if (c.kind !== 'tree') continue
    const b = read(...c.at)
    if (!b) return out
    if (LOG.test(nm(b))) { out.logs++; treeUp.add(c.tree) }
  }
  const tally = { fell: {}, level: {} }
  for (const c of rec?.clear ?? []) {
    const b = read(...c.at)
    if (!b) return out
    const here = nm(b) === c.name
    if (c.kind === 'tree') { if (LOG.test(nm(b))) tally.fell[c.q] = (tally.fell[c.q] ?? 0) + 1 } else if (c.kind === 'leaves') { if (here && treeUp.size) tally.fell[c.q] = (tally.fell[c.q] ?? 0) + 1 } else if (c.kind === 'stand') { if (here && !treeUp.has(c.tree)) { out.stands++; tally.level[c.q] = (tally.level[c.q] ?? 0) + 1 } } else if (here) { out.cuts++; tally.level[c.q] = (tally.level[c.q] ?? 0) + 1 }
  }
  for (const c of rec?.cells ?? []) {
    if (c.role !== 'fill') continue
    const b = read(...c.at)
    if (!b) return out
    if (!solid(b)) out.fills++
  }
  out.phase = out.logs > 0 ? 'fell' : out.stands + out.cuts + out.fills > 0 ? 'level' : (Number(rec?.surveys) || 0) < surveys && !rec?.prepDone ? 'survey' : 'done'
  out.byQuad = out.phase === 'fell' ? tally.fell : out.phase === 'level' ? tally.level : {}
  return out
}
/**
 * THE CANOPY LISTED (fellcanopy.mjs fellCanopy's entries: natural leaves round standing logs no stand sees) -> the next record |
 * null (nothing new). Pure. Appended as kind `leaves` clears in the quadrant of the tree they hide; never a cell already listed.
 */
export function whSiteCanopy (rec, entries = []) {
  if (!rec || rec.plot !== WHS_PLOT) return null
  const listed = new Set([...(rec.clear ?? []), ...(rec.cells ?? [])].map(c => kOf(c.at)))
  const add = []
  for (const e of entries) {
    if (!Array.isArray(e?.at) || listed.has(kOf(e.at))) continue
    listed.add(kOf(e.at))
    add.push({ at: e.at, kind: 'leaves', name: e.name, q: rec.trees?.[e.tree]?.q ?? quadOf(rec.box, e.at[0], e.at[2]), canopy: 1 })
  }
  return add.length ? { ...rec, clear: [...rec.clear, ...add], canopies: (Number(rec.canopies) || 0) + 1 } : null
}
/** THE FELLING'S VIEW (what runVisit works while a log stands): the stairs as its cells, the logs and leaves as its clears, the
 *  record's replants. Pure. */
export const whFellView = rec => ({ ...rec, cells: (rec.cells ?? []).filter(c => c.role === 'stand'), clear: (rec.clear ?? []).filter(c => c.kind === 'tree' || c.kind === 'leaves') })
/** THE LEVEL'S VIEW (every listed log down): the fills as its cells; the cuts, and the stairs' cells, as its clears; no replant is owed
 *  here (the felling's). Pure. */
export const whLevelView = rec => ({ ...rec, cells: (rec.cells ?? []).filter(c => c.role === 'fill'), clear: (rec.clear ?? []).filter(c => c.kind === 'cut' || c.kind === 'stand'), replant: [] })
/** In the felling's view a stair cell whose tree is down is DONE (never placed again): (cell, read) -> bool. Pure. */
export function whStandDone (rec, read) {
  const up = new Set()
  for (const c of rec?.clear ?? []) if (c.kind === 'tree' && LOG.test(nm(read(...c.at)))) up.add(c.tree)
  return c => c.role === 'stand' && !up.has(c.tree)
}
/**
 * THE QUADRANT A VISIT TAKES -> q | null (nothing left in the phase, or every quadrant with work is another bot's). Pure. `byQuad`
 * whPhase's; `slot` the builder's slot (1..): its own quadrant first, then round; `free(q)` is the quadrant's clear lease free (or
 * this bot's).
 */
export function whQuadFor (byQuad = {}, slot = 1, free = () => true) {
  const start = (Math.max(1, Number(slot) || 1) - 1) % WHS_QUADS.length
  for (let i = 0; i < WHS_QUADS.length; i++) { const q = WHS_QUADS[(start + i) % WHS_QUADS.length]; if ((byQuad[q] ?? 0) > 0 && free(q)) return q }
  return null
}
/** buildrun.mjs `clearPart` for a quadrant: its own lease, its own clears. Pure. */
export const whClearPart = q => ({ lease: `seg-clear-${q}`, has: c => c.q === q })
/** `warehouse` site rows' detail. Pure. */
export const whSiteDetail = (op, d = {}) => `op=${op} ` + ['phase', 'q', 'n', 'why', 'gen'].map(k => `${k}=${d[k] == null ? '-' : String(d[k]).replace(/\s+/g, '_').slice(0, 140)}`).join(' ')
/** The licence row (once per spawn). Pure. */
export const whSiteModeDetail = (site = WHSITE.site) => (site ? `on=1 core=${site.core.join(',')} grow=${site.grow.join(',')} floor=${site.floor} builders=${WHS_BUILDERS} quads=${WHS_QUADS.join('/')}` : 'on=0')
