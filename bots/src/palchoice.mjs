// civicroof-01show: A PALETTE'S NEXT CHOICE WHEN ITS FIRST HAS NO SOURCE, CHOSEN PER COURSE.
//
// Why (showcase 11-19, docs/reports/civicroof-2026-11-20.md): civicP's roof (palette roof ['dark_oak_stairs', 'spruce_stairs'])
// stopped `no_material` on every visit. The bill named dark_oak_stairs -- shop.mjs resolve() counts every wood part as had,
// because the visit crafts it from its species' planks -- but the town, the bags and the bots' map held no dark oak at all
// (no dark_oak_log gathered in 7 days), while the town held 102 spruce stairs. A bot that happened to carry spruce stairs placed
// them (buildrun.mjs blockFor takes any name of the role the bag holds), so the roof's first course became 8 dark oak and 3 spruce
// in whatever order the cells came. Nothing chose; the bag did.
//
// THE RULE (all builds through the building visit). A role's open cells are grouped by COURSE: one segment, one role, one height.
// For each course whose role names two or more blocks:
//   - the candidates are the role's names in palette order, except that a course whose placed cells are all ONE later name
//     continues that name first (a course begun in the alternative is finished in it, never patched back);
//   - a candidate HAS A SOURCE when the bag and the town together hold enough for the course's open cells (counted across the
//     courses of one visit), or the bag and the town hold the planks or logs its recipe takes (a wood part; planks from logs), or
//     the bots' map knows a live find of the log it comes from within a trip, or an open refill job is bringing it or that log;
//   - the first candidate with a source is taken. When it is the role's first name, nothing changes (the base's behaviour, no row).
//     When it is not, every open cell of the course is placed in it and only it -- never a cell-by-cell mix of whatever the bag
//     holds -- and the bill draws it; a `_palette_choice` row says what was taken and why;
//   - when no candidate has a source, nothing is constrained (the base's behaviour) and the row says so.
// Pure. Switch: PALCHOICE=off restores the base (no choice is made, no row).
import { WOOD_PART } from './townstyle.mjs'

const isOff = v => ['off', '0', 'false', 'no'].includes(String(v ?? '').trim().toLowerCase())
export const PALCHOICE = Object.freeze({ on: !isOff(typeof process !== 'undefined' ? process.env?.PALCHOICE : undefined) })
/** How far from home a map find of the log still counts as a source (a trip a bot makes: the expedition's rings reach 128-256). */
export const ATLAS_TRIP_R = 320

const SPECIES = '(oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak)'
const PART_RE = new RegExp(`^${SPECIES}_(stairs|slab|trapdoor|fence)$`)
const PLANKS_RE = new RegExp(`^${SPECIES}_planks$`)
const LOG_RE = new RegExp(`^${SPECIES}_log$`)
const k3 = a => `${a[0]},${a[1]},${a[2]}`

/** The log a name is made from (a wood part or planks: its species' log; a log: itself) -> name | null. Pure. */
export function logOf (name) {
  const n = String(name ?? '')
  if (LOG_RE.test(n)) return n
  const m = PART_RE.exec(n) ?? PLANKS_RE.exec(n)
  return m ? `${m[1]}_log` : null
}

/**
 * DOES A NAME HAVE A SOURCE FOR `n` MORE -> { ok, why }. Pure.
 *   held(name)  what the bag and the town hold of a name (the caller subtracts what earlier courses of the visit took)
 *   finds       the bots' map's live finds [{ kind, x, z }] (atlas.mjs foldAtlas); `home` {x, z} for the trip radius
 *   jobs        the town's open refill jobs [{ kind }]
 */
export function sourceOf (name, n, { held = () => 0, finds = [], home = null, jobs = [], tripR = ATLAS_TRIP_R } = {}) {
  const h = Math.max(0, Number(held(name)) || 0)
  if (h >= n) return { ok: true, why: `held:${h}` }
  const short = n - h
  const part = PART_RE.exec(name)
  const pl = part ? `${part[1]}_planks` : PLANKS_RE.test(name) ? name : null
  if (pl) {
    // what the recipe takes in planks for the shortfall, and the planks the bag and the town can give (4 a log)
    const p = part ? WOOD_PART[part[2]] : null
    const want = p ? Math.ceil(short / p.makes) * p.planks : short
    const have = (pl === name ? 0 : Math.max(0, Number(held(pl)) || 0)) + 4 * Math.max(0, Number(held(logOf(name))) || 0)
    if (have >= want) return { ok: true, why: `craft:${pl}:${have}/${want}` }
  }
  const log = logOf(name)
  if (log) {
    const f = (finds ?? []).find(q => q?.kind === log && (!home || Math.hypot((Number(q.x) || 0) - home.x, (Number(q.z) || 0) - home.z) <= tripR))
    if (f) return { ok: true, why: `atlas:${log}@${Math.round(f.x)},${Math.round(f.z)}` }
  }
  const job = (jobs ?? []).find(j => j?.kind === name || (log && j?.kind === log))
  if (job) return { ok: true, why: `job:${job.kind}` }
  return { ok: false, why: `none(held=${h}/${n})` }
}

/**
 * THE VISIT'S CHOICES -> { choice: Map cellKey -> name, rows: [{ seg, role, y, open, placed, first, firstWhy, took, why }] }. Pure.
 *   record   { cells: [{ at, role, seg }] }
 *   names    role -> the role's names in palette order (shop.mjs roleNames: '$planks' resolved, '*solid' dropped)
 *   read     (x, y, z) -> block | null; `done(block, cell)` the visit's own done test (state-bearing cells in their state)
 *   source   (name, n) -> { ok, why } (sourceOf with the visit's stock bound; `n` is what this course still needs)
 * A choice is made only for a course whose taken name is not the role's first; every other course is the base's.
 */
export function paletteChoice (record, { names, read, done, source }) {
  const choice = new Map(), rows = []
  const groups = new Map()
  for (const c of record?.cells ?? []) {
    if (!c || c.role === 'fill' || !Array.isArray(c.at)) continue
    const g = `${c.seg}|${c.role}|${c.at[1]}`
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g).push(c)
  }
  const used = {}
  const take = (name, n) => { used[name] = (used[name] ?? 0) + n }
  for (const cells of groups.values()) {
    const { seg, role } = cells[0], y = cells[0].at[1]
    const list = names(role) ?? []
    if (list.length < 2) continue
    const open = [], placed = {}
    for (const c of cells) {
      const b = read(...c.at)
      if (done(b, c)) { const n = b?.name ?? '?'; placed[n] = (placed[n] ?? 0) + 1 } else open.push(c)
    }
    if (!open.length) continue
    const placedNames = Object.keys(placed).filter(n => list.includes(n))
    const cont = placedNames.length === 1 && Object.keys(placed).length === 1 && placedNames[0] !== list[0] ? placedNames[0] : null
    const cands = cont ? [cont, ...list.filter(n => n !== cont)] : list
    const src = n => source(n, open.length, used)
    const first = src(list[0])
    if (!cont && first.ok) { take(list[0], open.length); continue }   // the role's first name has a source: the base's behaviour
    let took = null, why = null
    for (const n of cands) { const s = n === list[0] ? first : src(n); if (s.ok) { took = n; why = s.why; break } }
    const row = { seg, role, y, open: open.length, placed, first: list[0], firstWhy: first.why, took: took ?? '-', why: took ? (cont === took ? `course:${why}` : why) : 'none' }
    rows.push(row)
    if (!took || took === list[0]) { if (took) take(took, open.length); continue }
    take(took, open.length)
    for (const c of open) choice.set(k3(c.at), took)
  }
  return { choice, rows }
}

/** The `_palette_choice` row's detail. Pure. */
export function paletteChoiceDetail (project, r) {
  const placed = Object.entries(r.placed ?? {}).map(([n, c]) => `${n}:${c}`).join(',') || '-'
  return `project=${project} seg=${r.seg} role=${r.role} y=${r.y} open=${r.open} placed=${placed} first=${r.first}:${r.firstWhy} took=${r.took} why=${r.why}`
}
