// BOARDWALK-03 (OWNER 11-08): THE BOTS' DIRT AND COBBLE IN WATER -> PLANK WALKWAYS WHERE BOTS CROSS, CLEAN WATER EVERYWHERE ELSE.
// PURE: the switch, the evidence file's checks, the work list. Nothing here touches a bot, a file or the world.
//
// WHY. The fleet towns' lakes hold the bots' own lines and lumps of dirt, grass-on-dirt and cobblestone standing in the water --
// left by the pathfinder's scaffold before nobridge-01 (owner 10-27: no water bridging) and by climbs and escapes since. The owner
// wants them gone, and a plank walkway only where the bots really cross.
//
// THE EVIDENCE (owner: "remove only blocks the bots placed ... never natural blocks"). bots/src/waterstrays/<pool>.json, written
// read-only by scripts/host/waterstrays.py: a cell is listed only when Paper 1.21.8 build 60 -- the jar that made the world --
// generates WATER or open air there from the world's own seed (genesis) and the live world holds a bot material, at or above the
// genesis water surface, with live water on two sides (standing in water, not a bay the bots filled into land). The bots' own
// `_place_town` rows confirm what they cover. A line the bots stood on in >= 6 (bot, 10-min) episodes on >= 2 days is `walk`.
// The bot digs a listed cell ONLY while the world still shows that block there (the dirt family counts as one: placed dirt greens),
// never a cell any project's record names, and never anything not listed. A stale or foreign file (another home, older than
// BW3.maxAgeMs) is refused whole.
//
// WHAT IT DOES (the keeper's tidy visit, every BW3.everyMs, before its stage work: skills.mjs waterWalkVisit):
//   * a `walk` line becomes PLANKS IN PLACE: one record cell (role `deck`, any planks) per column at the line's lowest listed cell,
//     chained from the shore outward (segment W<line>-<k> waits on W<line>-<k-1>): runVisit's foreign dig takes the dirt out and
//     the click lays the plank into the same cell before the next cell is touched, so the crossing is never more than one cell
//     short. Listed cells above a deck cell are cut first (top first).
//   * every other listed cell is CUT, far end first (a line is dug back toward the shore it joins, so the digger always has the
//     line behind it to walk back on); an island line no stand reaches is passed over (nothing tried, nothing counted).
// The pathfinder is not touched: it still never bridges water (owner 10-27). Swimming is travel (owner): a bot that ends in the
// water swims.

export const BW3_PLOT = 'waterwalk'
export const BW3 = Object.freeze({ everyMs: 15 * 60_000, r: 104, walkR: 112, maxAgeMs: 30 * 24 * 60 * 60_000, cutsPerVisit: 24, builders: 2, minVisitMs: 45_000 })
/** The deck: any planks (the bag's, or crafted from the town's logs above the 512 reserve). */
export const BW3_PALETTE = Object.freeze({ deck: ['$planks'] })
/** THE SWITCH: BOARDWALK3=off|0|false|no -> nothing is cut or laid; on by default. WALKWAYS=off -> walk lines are cut like the rest. */
export const bw3On = (env = process.env) => !/^(off|0|false|no)$/i.test(String(env?.BOARDWALK3 ?? '').trim())
export const bw3WalkOn = (env = process.env) => !/^(off|0|false|no)$/i.test(String(env?.WALKWAYS ?? '').trim())

// the materials a listed cell may hold (waterstrays.py BOT_MAT); dirt, coarse dirt, rooted dirt and grass are one family
export const BOT_MAT = /^(dirt|coarse_dirt|rooted_dirt|grass_block|cobblestone|mossy_cobblestone|cobbled_deepslate|netherrack|stone|andesite|diorite|granite|deepslate|tuff|sandstone|red_sandstone|dripstone_block)$/
const DIRT = /^(dirt|coarse_dirt|rooted_dirt|grass_block)$/
const nm = b => String(b?.name ?? '').replace(/\[.*\]$/, '')
const k3 = a => a.join(',')
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]]
const WATERN = /^(water|bubble_column|kelp|kelp_plant|seagrass|tall_seagrass)$/

/** Does the world still show the listed block (the dirt family as one)? -> the name standing there | null. Pure. */
export function standingAs (b, listed) {
  const n = nm(b)
  if (!b || !n || !BOT_MAT.test(n)) return null
  if (n === listed) return n
  return DIRT.test(n) && DIRT.test(String(listed)) ? n : null
}

/**
 * THE EVIDENCE FILE'S CHECKS -> { ok, why, lines }. Pure. Refused whole: a wrong version, another pool or home (a reseeded or
 * moved town), a file older than maxAgeMs, a malformed line. `lines`: [{ id, walk, cells: [{ at, name, row }] }].
 */
export function bw3Evidence (doc, { pool, home, now = Date.now(), maxAgeMs = BW3.maxAgeMs } = {}) {
  if (!doc || doc.v !== 1 || !Array.isArray(doc.lines)) return { ok: false, why: 'no_file', lines: [] }
  if (pool != null && doc.pool !== pool) return { ok: false, why: 'other_pool', lines: [] }
  const h = doc.home
  if (!home || !Array.isArray(h) || h[0] !== Math.floor(home.x) || h[1] !== Math.floor(home.y) || h[2] !== Math.floor(home.z)) return { ok: false, why: 'other_home', lines: [] }
  const at = Date.parse(doc.generated ?? '')
  if (!Number.isFinite(at) || now - at > maxAgeMs || at - now > 60 * 60_000) return { ok: false, why: 'stale', lines: [] }
  const lines = []
  for (const l of doc.lines) {
    if (!l || !Array.isArray(l.cells)) return { ok: false, why: 'malformed', lines: [] }
    const cells = []
    for (const c of l.cells) {
      if (!Array.isArray(c) || c.length < 4 || !c.slice(0, 3).every(Number.isInteger) || !BOT_MAT.test(String(c[3]))) return { ok: false, why: 'malformed', lines: [] }
      cells.push({ at: c.slice(0, 3), name: String(c[3]), row: c[4] === 1 })
    }
    lines.push({ id: String(l.id ?? `L${lines.length}`), walk: l.walk === true, cells })
  }
  return { ok: true, why: 'ok', lines }
}

/**
 * A LINE'S COLUMNS IN STEPS FROM THE SHORE -> Map "x,z" -> d (0 = a column beside land; Infinity = an island). Pure over `read`.
 * Land: a 4-neighbour column, not one of the line's, whose block at the line's level (or one above) is a full solid that is not
 * water -- the bank a digger stands on.
 */
export function shoreSteps (cells, read) {
  const top = new Map()
  for (const c of cells) { const k = `${c.at[0]},${c.at[2]}`; if (!top.has(k) || c.at[1] > top.get(k).at[1]) top.set(k, c) }
  const low = new Map()
  for (const c of cells) { const k = `${c.at[0]},${c.at[2]}`; if (!low.has(k) || c.at[1] < low.get(k).at[1]) low.set(k, c) }
  const land = (x, y, z) => { const b = read(x, y, z); return !!b && b.boundingBox === 'block' && !WATERN.test(nm(b)) }
  const d = new Map(), parent = new Map()
  const q = []
  for (const [k, c] of low) {
    const [x, , z] = c.at, y = c.at[1]
    const shore = N4.some(([dx, dz]) => !top.has(`${x + dx},${z + dz}`) && (land(x + dx, y, z + dz) || land(x + dx, y + 1, z + dz)))
    if (shore) { d.set(k, 0); q.push(k) }
  }
  for (let i = 0; i < q.length; i++) {
    const [x, z] = q[i].split(',').map(Number)
    for (const [dx, dz] of N4) { const n = `${x + dx},${z + dz}`; if (top.has(n) && !d.has(n)) { d.set(n, d.get(q[i]) + 1); parent.set(n, q[i]); q.push(n) } }
  }
  for (const k of top.keys()) if (!d.has(k)) d.set(k, Infinity)
  d.parent = parent
  return d
}

/**
 * THE WORK -> { cuts, record, stats }. Pure over `read`.
 *   cuts    [{ at, kind: 'tidy', name }] in the visit's order (runVisit `tidy` + `tidyKeepOrder`): per line, the far columns first,
 *           top first within a column; a walk line's cells above its deck cells first of all
 *   record  { cells: [{ at, role: 'deck', seg }], segments: [{ seg, deps }], clear: [], cut: [] }: the walk lines' deck cells
 *   stats   { lines, walk, standing, gone, guarded, islands, deck, deckDone }
 *   guard(key) -> true for a cell another project's record names (never dug, never laid)
 *   walkOn  WALKWAYS switch: off, every line is cut
 */
export function bw3Work (lines, read, { guard = () => false, walkOn = true } = {}) {
  const cuts = [], cells = [], segments = []
  const st = { lines: lines.length, walk: 0, standing: 0, gone: 0, guarded: 0, islands: 0, deck: 0, deckDone: 0 }
  lines.forEach((l, li) => {
    const steps = shoreSteps(l.cells, read)
    const live = []
    for (const c of l.cells) {
      if (guard(k3(c.at))) { st.guarded++; continue }
      const n = standingAs(read(...c.at), c.name)
      if (!n) { st.gone++; continue }
      st.standing++
      live.push({ ...c, name: n, d: steps.get(`${c.at[0]},${c.at[2]}`) ?? Infinity })
    }
    if (live.length && live.every(c => c.d === Infinity)) st.islands++
    const walk = walkOn && l.walk && live.some(c => c.d !== Infinity)
    if (!walk) {
      // far end first (an island's Infinity first: no stand reaches it, nothing is tried), top first in a column
      for (const c of live.sort((a, b) => b.d - a.d || b.at[1] - a.at[1] || a.at[0] - b.at[0] || a.at[2] - b.at[2])) cuts.push({ at: c.at, kind: 'tidy', name: c.name })
      return
    }
    st.walk++
    // THE DECK: the line's lowest listed cell in each reached column (whether it still stands or is laid already)
    const low = new Map()
    for (const c of l.cells) {
      if (guard(k3(c.at))) continue
      const k = `${c.at[0]},${c.at[2]}`
      if ((steps.get(k) ?? Infinity) === Infinity) continue
      if (!low.has(k) || c.at[1] < low.get(k).at[1]) low.set(k, c)
    }
    const deckK = new Set([...low.values()].map(c => k3(c.at)))
    for (const c of live.filter(q => !deckK.has(k3(q.at))).sort((a, b) => b.at[1] - a.at[1] || b.d - a.d)) cuts.push({ at: c.at, kind: 'tidy', name: c.name })
    // ONE CELL A SEGMENT, each waiting on the cell it is reached from (its BFS parent, one step nearer a bank): the foreign dig and the
    // plank happen in that one cell before the next segment opens -- never two cells of a crossing open at once
    const segOf = col => `W${String(li).padStart(3, '0')}-${steps.get(col)}-${col.replace(',', '_')}`
    for (const c of [...low.values()].sort((a, b) => steps.get(`${a.at[0]},${a.at[2]}`) - steps.get(`${b.at[0]},${b.at[2]}`) || a.at[0] - b.at[0] || a.at[2] - b.at[2])) {
      const col = `${c.at[0]},${c.at[2]}`
      const par = steps.parent.get(col)
      segments.push({ seg: segOf(col), deps: par != null && low.has(par) ? [segOf(par)] : [] })
      cells.push({ at: c.at, role: 'deck', seg: segOf(col) })
      st.deck++
      if (/_planks$/.test(nm(read(...c.at)))) st.deckDone++
    }
  })
  return { cuts, record: { v: 1, blueprint: 'waterwalk@1', plot: BW3_PLOT, cells, segments, clear: [], cut: [], replant: [], zones: [] }, stats: st }
}

/** Is there work a visit can do now? (a cut still standing, or a deck cell not yet planks). Pure. */
export const bw3HasWork = w => !!w && (w.cuts.length > 0 || w.stats.deck > w.stats.deckDone)
/** The planks a visit still owes its open deck cells (less the bag's spare), at most `cap`. Pure. */
export const bw3PlanksOwed = (w, spare = 0, cap = 64) => Math.max(0, Math.min(cap, (w?.stats?.deck ?? 0) - (w?.stats?.deckDone ?? 0) - Math.max(0, spare)))
/** The visit's row detail (`_waterwalk`). Pure. */
export function bw3Detail ({ op = 'visit', stats = {}, cuts = 0, placed = 0, cleared = 0, stop = '-', planks = 0, why = '' } = {}) {
  return `op=${op} lines=${stats.lines ?? 0} walk=${stats.walk ?? 0} standing=${stats.standing ?? 0} gone=${stats.gone ?? 0} cuts=${cuts} deck=${stats.deckDone ?? 0}/${stats.deck ?? 0} placed=${placed} cleared=${cleared} planks=${planks} stop=${stop}${why ? ` why=${String(why).replace(/\s+/g, '_').slice(0, 60)}` : ''}`
}
