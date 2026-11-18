// GRADETIDY-01show (T11 bundle, item 8 (b); design docs/reports/gradetidy-design-2026-11-18.md): THE CLEAN-UP GRADES TOWARD THE GROUND
// PLAN. The plan (draft 3, docs/reports/gradeplan-2026-11-18/draft3/target.json) gives every town column a target height and a class.
// It is published per pool as `grade-target.json` (scripts/host/gradetarget.py: the plan's box/h/class, a version `v`, the source's
// `sha256`, and a GATE -- the columns this release may grade; release 1: terrace T11 only). The inside-the-wall survey (tidy.mjs
// siteStage) reads it as a pure lookup and, for every gated column with a target, plans exactly:
//   ABOVE the target  a tidy cut for every ground block above it (top first), and the block left AT the target, if it is not earth,
//                     a `topsoil` re-top (dug and laid with dirt only while the bag holds the dirt: tidytop.mjs retopHeld);
//   BELOW the target  fills up to it: the cells under the target `earth` (coreFills makes them `core`: cobblestone first) and the cell
//                     at the target `topsoil` (dirt only);
//   AT the target     nothing, unless its top is not earth: a `topsoil` re-top.
// Classes: `t` terrace, `b` bank, `a` apron, `e` eased edge -- ordinary ground with a target. `o` outside, `f` fixed, `w` water and a
// column with no entry -> NO OPINION (today's survey). An UNKNOWN class -> no opinion too, counted (`unknown_class`), never a throw.
// A gated column the grade cannot work (a tree, a built block, water, a protected column, a block it may not cut) is left to nobody
// and counted by reason: the grade never plans half a column. Every gated column is the grade's (the survey's own heuristics --
// pits, pillars, rough ground, regrade -- stay out of it, `cols`). GRADE=off: no grade (the survey as before).
// A LEAF but for tidy.mjs's column reader and cut rule (passed in: no import cycle).

export const GRADE = Object.freeze({ file: 'grade-target.json', above: 16, below: 16, hollow: 4 })
export const gradeOn = (env = process.env) => !/^(off|0|false|no)$/i.test(String(env?.GRADE ?? '').trim())
/** THE PROCESS'S TARGET SOURCE (skills.mjs sets it once: the pool's grade-target.json) -> { t } | null. tidy.mjs siteStage's default
 *  `grade`; unset or throwing: null (the survey as before). */
let gradeSource = null
export const setGradeSource = fn => { gradeSource = typeof fn === 'function' ? fn : null }
export const gradeProvided = () => { try { return gradeSource ? gradeSource() : null } catch { return null } }

const k2 = (x, z) => `${x},${z}`
const nm = b => String(b?.name ?? '').replace(/^minecraft:/, '').replace(/\[.*\]$/, '')
/** The classes with a target (ground). */
export const GRADE_CLASSES = Object.freeze({ t: 'terrace', b: 'bank', a: 'apron', e: 'edge' })
/** The classes the plan names that mean "leave it" (no opinion). */
export const NO_OPINION = Object.freeze({ o: 'outside', f: 'fixed', w: 'water' })
/** An earth top (grade_pct's numerator: dirt_path counts as earth). */
export const EARTH_TOP = /^(grass_block|dirt|coarse_dirt|podzol|rooted_dirt|mycelium|moss_block|dirt_path)$/

/**
 * THE PUBLISHED TARGET -> { ok, t, why }. Pure. `raw` the parsed grade-target.json. Checks the shape (box of 4 numbers, h and class
 * rows covering it, v, sha256, a gate of [x, z] columns) and builds the gate's lookup. Never throws.
 */
export function gradeTarget (raw) {
  try {
    if (!raw || typeof raw !== 'object') return { ok: false, t: null, why: 'no_file' }
    const box = raw.box
    if (!Array.isArray(box) || box.length !== 4 || !box.every(Number.isFinite)) return { ok: false, t: null, why: 'bad_box' }
    const w = box[2] - box[0] + 1, d = box[3] - box[1] + 1
    if (!(w > 0 && d > 0) || !Array.isArray(raw.h) || raw.h.length !== d || !Array.isArray(raw.class) || raw.class.length !== d) return { ok: false, t: null, why: 'bad_rows' }
    if (raw.h.some(r => !Array.isArray(r) || r.length !== w) || raw.class.some(r => typeof r !== 'string' || r.length !== w)) return { ok: false, t: null, why: 'bad_rows' }
    if (!Number.isFinite(Number(raw.v)) || typeof raw.sha256 !== 'string' || !raw.sha256) return { ok: false, t: null, why: 'no_version' }
    const cols = Array.isArray(raw.gate?.cols) ? raw.gate.cols.filter(c => Array.isArray(c) && c.length === 2 && c.every(Number.isFinite)) : []
    if (!cols.length) return { ok: false, t: null, why: 'no_gate' }
    return { ok: true, why: 'ok', t: { v: Number(raw.v), sha256: raw.sha256, box, h: raw.h, cls: raw.class, gateId: String(raw.gate?.id ?? '-'), gate: new Set(cols.map(([x, z]) => k2(x, z))) } }
  } catch { return { ok: false, t: null, why: 'bad_file' } }
}
/** The version tag a row carries -> `v<v>:<first 8 of sha256>:<gate id>` | null. Pure. */
export const gradeV = t => (t ? `v${t.v}:${String(t.sha256).slice(0, 8)}:${t.gateId}` : null)

/** THE LOOKUP -> { y, cls } | { y: null, cls, why }. Pure. `why`: outside_box, no_opinion (o/f/w), unknown_class, no_height. */
export function targetAt (t, x, z) {
  if (!t) return { y: null, cls: null, why: 'no_target' }
  const [x0, z0, x1, z1] = t.box
  if (x < x0 || x > x1 || z < z0 || z > z1) return { y: null, cls: null, why: 'outside_box' }
  const cls = t.cls[z - z0][x - x0]
  if (Object.prototype.hasOwnProperty.call(NO_OPINION, cls)) return { y: null, cls, why: 'no_opinion' }
  if (!Object.prototype.hasOwnProperty.call(GRADE_CLASSES, cls)) return { y: null, cls, why: 'unknown_class' }
  const y = Number(t.h[z - z0][x - x0])
  if (!Number.isFinite(y)) return { y: null, cls, why: 'no_height' }
  return { y, cls }
}

/**
 * THE GRADE'S WORK FOR ONE COLUMN -> { cut: [{at, name}], fill: [{at, role, retop?}], why: null } | { why } (left alone). Pure over
 * `read`. `col(x, z)` the column's ground (tidy.mjs tidyColumn: { y, name, why, tree }); `cuttable(name)` the cut rule (LEVEL_CUT);
 * `liquid(b)` a liquid block. Never plans half a column: any block it may not cut, a tree, water at or beside the worked heights ->
 * the reason, nothing planned.
 */
export function gradeColumn (read, x, z, y, { col, cuttable, liquid }) {
  const g = col(x, z, y)
  if (g.y == null) return { why: g.why === 'water' ? 'water' : g.why === 'built' || g.why === 'furniture' ? 'built' : 'no_ground' }
  const h = g.y
  const empty = b => !b || /^(air|cave_air|void_air)$/.test(nm(b)) || b.boundingBox === 'empty'
  // a TRUNK in the column is a tree (its felling is the tree rules'); a canopy's leaves over the ground are not in the way
  for (let yy = Math.min(h, y) + 1; yy <= Math.max(h, y) + GRADE.above; yy++) if (/_(log|wood|stem)$/.test(nm(read(x, yy, z)))) return { why: 'tree' }
  const wet = yy => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => liquid(read(x + dx, yy, z + dz)))
  const cut = [], fill = []
  const lo = Math.min(h, y), hi = Math.max(h, y)
  for (let yy = lo; yy <= hi; yy++) if (wet(yy)) return { why: 'water_beside' }
  // the cell AT the target once everything above it is gone: earth stays; a block to swap is a re-top; a HOLLOW (air under a crust,
  // the bots' layered spoil) is filled from its floor up -- at most GRADE.hollow deep, else the column is left
  const atTarget = () => {
    const b = read(x, y, z)
    if (empty(b)) {
      let yy = y - 1
      while (yy >= y - GRADE.hollow && empty(read(x, yy, z))) yy--
      if (yy < y - GRADE.hollow) return 'hollow_deep'
      for (let k = yy + 1; k < y; k++) fill.push({ at: [x, k, z], role: 'earth' })
      fill.push({ at: [x, y, z], role: 'topsoil' })
      return null
    }
    const n = nm(b)
    if (EARTH_TOP.test(n)) return null
    if (!cuttable(n)) return 'not_cuttable'
    fill.push({ at: [x, y, z], role: 'topsoil', retop: true })
    return null
  }
  if (h > y) {
    for (let yy = h; yy > y; yy--) {
      const b = read(x, yy, z)
      if (empty(b)) continue   // a gap under floating spoil, a plant: nothing to dig
      const n = nm(b)
      if (!cuttable(n)) return { why: 'not_cuttable' }
      cut.push({ at: [x, yy, z], name: n })
    }
    const w = atTarget()
    if (w) return { why: w }
  } else if (h < y) {
    for (let yy = h + 1; yy < y; yy++) fill.push({ at: [x, yy, z], role: 'earth' })
    fill.push({ at: [x, y, z], role: 'topsoil' })
  } else {
    const w = atTarget()
    if (w) return { why: w }
  }
  return { cut, fill, why: null, h }
}

/**
 * THE GRADE'S SURVEY -> { cut, fill, pits, cols, skipped, v }. Pure over `read`. Every GATED column with a target: its work
 * (gradeColumn) or its reason; `avoid(x, z)` (the tidy's own protected columns: zones, builds, plots) and `cells` (another record's
 * cells, by column) are honoured at run time -- a column claimed after the plan was made stays safe. `cols`: every gated column the
 * grade owns (worked or left for a reason other than "no opinion"): the survey's other rules stay out of them. One pit a column
 * (`gr<n>`), nearest `home` first.
 */
export function gradeSurvey (read, t, { home = { x: 0, z: 0 }, avoid = () => null, cellCols = new Set(), col, cuttable, liquid } = {}) {
  const out = { cut: [], fill: [], pits: [], cols: new Set(), skipped: {}, v: gradeV(t) }
  if (!t) return out
  const skip = (why, n = 1) => { out.skipped[why] = (out.skipped[why] ?? 0) + n }
  const gate = [...t.gate].map(k => k.split(',').map(Number)).sort((a, b) => Math.max(Math.abs(a[0] - home.x), Math.abs(a[1] - home.z)) - Math.max(Math.abs(b[0] - home.x), Math.abs(b[1] - home.z)) || a[0] - b[0] || a[1] - b[1])
  let n = 0
  for (const [x, z] of gate) {
    const tg = targetAt(t, x, z)
    if (tg.y == null) { skip(tg.why); continue }
    out.cols.add(k2(x, z))
    const av = avoid(x, z)
    if (av) { skip(`avoided:${String(av).split(':').slice(0, 2).join(':').replace(/[,\s]/g, '_')}`); continue }   // the reason's kind (project:paths, zone:...)
    if (cellCols.has(k2(x, z))) { skip('cell_column'); continue }
    const w = gradeColumn(read, x, z, tg.y, { col, cuttable, liquid })
    if (w.why) { skip(w.why); continue }
    if (!w.cut.length && !w.fill.length) { skip('at_target'); continue }
    const id = `gr${n++}`
    out.cut.push(...w.cut.map(c => ({ ...c, grade: true })))
    out.fill.push(...w.fill.map(f => ({ ...f, pit: id, grade: true })))
    if (w.fill.length) out.pits.push({ id, cols: [[x, z]], n: w.fill.length, kind: 'grade' })
  }
  return out
}

/** THE SURVEY WITHOUT THE GRADE'S COLUMNS -> a survey part. Pure. Every cut, fill and pit in a column the grade owns goes. */
export function dropGradeCols (sv, cols) {
  if (!cols?.size) return sv
  const inG = at => cols.has(k2(at[0], at[2]))
  const fill = (sv.fill ?? []).filter(f => !inG(f.at))
  const pitsLeft = new Set(fill.map(f => f.pit))
  return { ...sv, cut: (sv.cut ?? []).filter(c => !inG(c.at)), fill, pits: (sv.pits ?? []).filter(p => pitsLeft.has(p.id)), clear: (sv.clear ?? []).filter(c => !inG(c.at)) }
}

/** The survey's grade summary for the record and the refresh row -> { v, cut, fill, cols, skipped }. Pure. */
export const gradeSummary = gw => ({ v: gw?.v ?? null, cut: gw?.cut?.length ?? 0, fill: gw?.fill?.length ?? 0, cols: gw?.cols?.size ?? 0, skipped: { ...(gw?.skipped ?? {}) } })
/** What a refresh ADDED of the grade's (cells and cuts stamped `added: now` with `grade`) -> { cut, fill }. Pure. */
export function gradeAdded (rec, now) {
  const isNew = q => q?.grade && q.added === now
  return { cut: (rec?.cut ?? []).filter(isNew).length, fill: (rec?.cells ?? []).filter(isNew).length }
}

/**
 * THE GRADE TAKES OVER A FINISHED COLUMN (design (b): "a column already named but at the wrong height is re-named only when its
 * record cell is complete or waived") -> { rec, released: [col keys] }. Pure over the tests. In each gated column `cols` where every
 * entry the record names is finished -- every fill done (`done(cell)`) or carried (`prev`), every cut down (`!standing(cut)`), no
 * clear -- or waived, those entries (and their waivers) leave the record, so the refresh's merge plans the column from the target.
 * A column with any open work keeps it all (never two plans in one column).
 */
export function releaseGradeCols (rec, cols, { done = () => false, standing = () => true } = {}) {
  if (!rec || !cols?.size) return { rec, released: [] }
  const w = rec.waived ?? {}
  const kOf = at => at.join(',')
  const colK = at => k2(at[0], at[2])
  const isW = at => Object.prototype.hasOwnProperty.call(w, kOf(at))
  const open = new Set()
  for (const c of rec.cells ?? []) if (cols.has(colK(c.at)) && !c.prev && !isW(c.at) && !done(c)) open.add(colK(c.at))
  for (const c of rec.cut ?? []) if (cols.has(colK(c.at)) && !isW(c.at) && standing(c)) open.add(colK(c.at))
  for (const c of rec.clear ?? []) if (cols.has(colK(c.at))) open.add(colK(c.at))
  const named = new Set([...(rec.cells ?? []), ...(rec.cut ?? [])].map(c => colK(c.at)).filter(k => cols.has(k)))
  for (const k of Object.keys(w)) { const [x, , z] = k.split(','); if (cols.has(k2(x, z))) named.add(k2(x, z)) }
  const rel = new Set([...named].filter(k => !open.has(k)))
  if (!rel.size) return { rec, released: [] }
  const keep = q => !rel.has(colK(q.at))
  const waived = Object.fromEntries(Object.entries(w).filter(([k]) => { const [x, , z] = k.split(','); return !rel.has(k2(x, z)) }))
  return { rec: { ...rec, cells: (rec.cells ?? []).filter(keep), cut: (rec.cut ?? []).filter(keep), ...(rec.waived ? { waived } : {}) }, released: [...rel] }
}
