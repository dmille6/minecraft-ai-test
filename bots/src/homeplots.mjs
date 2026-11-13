// HOMES-01SHOW: THE TOWN LAYOUT'S HOME PLOTS (OWNER 2026-11-13: the approved layout's eight homes; a plot that meets a road corridor
// may be moved or the road rerouted, "either, as long as the thing gets built"; "yes" to all eight becoming cottage projects).
// LIVE showcase before it: `cottage2` answered `no_site` on every visit -- the cottage's siting took ONLY the first free house plot of
// the wall extension (cottage.mjs cottagePlotOf) and came back to that same plot after every 30-min wait, and there were three cottage
// projects. PURE but for the one file read at load: the switch, the layout (townlayout.json, checked against the pool and the home as
// townsectors.json is), the plots' place among the town's reservations (a plot that meets a road corridor or a reservation is SHIFTED
// up to 4 blocks, else skipped by name), the offer (the layout's plots first, then the extension's house plots), the ROTATION past a
// plot whose siting failed, the driver that sites over the offered plots inside one search box, the cottage projects' names, the rows.
//
//   HOMEPLOTS=on|off   unset = on only in HOMEPLOTS_POOLS (default 'showcase'). A town with no layout entry: everything exactly as
//                      before (three cottage projects, the extension's first free plot). OFF in a town WITH a layout: no layout plot
//                      is offered, reserved or kept off (skills.mjs housePlotsNow answers the extension's own record) and a later
//                      home (cottage4 ..) that was NEVER SITED is never offered or sited (laterHomeHeld: it waits) -- but one that
//                      already HAS a record stays an ordinary project: it is finished and repaired, and the retrofit's one-at-a-time
//                      wait on it (reroof.mjs reroofNext `styled_open`) ends by itself (review r1, Codex: a record left guarded but
//                      unworked held the planner for good). So the project LIST follows the layout, never the switch.
//   THE PLOT           the approved 7 x 7 pad widened by 2: 11 x 11, the wall extension's own house-plot size (wall.mjs WALLEXT
//                      plotSizes), the least on which EVERY look of the cottage family fits. MEASURED 11-13 on flat ground with the
//                      real siting (buildsite.mjs siteBlueprint + cottageSitingPlan), the eight showcase pads widened by 1 (9 x 9, the
//                      least cottageOpening opens on): the two long bodies (9 x 7, 7 x 9 + the ring) fit NO plot, and three plots
//                      (H1, H2, H8, the ones nearly diagonal from home) take NO look at all -- a 9 x 9 leaves one pad position a
//                      facing, and none of the four has its door toward home (buildsite.mjs facesHome: the door's side must be the
//                      cardinal nearest the door -> home line). Widened by 2: seven of eight; H1 still none.
//   THE SHIFT          a plot whose box meets ANY reservation (a `land:road` corridor, another record's zone, a sibling plot), or
//                      inside which no 7 x 7 pad has a door toward home (homeFacing: facesHome's rule), is tried at every offset
//                      within +-4, nearest first, the first that clears them all and takes a home-facing pad; none at 11 x 11: the
//                      same at 9 x 9 (the square looks still fit); none: skipped `road_no_shift` (a corridor was among what it met),
//                      `blocked:<the zone's why>` (a record sits on it, or its reservations leave no room) or `door_no_shift`. The
//                      land plan is never edited. The siting itself refuses a footprint that meets any zone (buildsite.mjs
//                      screenSite `zone`), so a box the resolver refuses is one no cottage could have been proven on.
//   THE ROTATION       a failed siting is remembered PER PLOT (the town's file, skills.mjs homeFailNote: when, why, which project). The
//                      offer puts every plot with no failure inside HOMEPLOT.retryMs first, in the layout's order, then the failed
//                      ones, the OLDEST failure first: the next attempt takes the NEXT plot, and a failed plot comes back only after
//                      every other free plot, or after retryMs. Never a dead end: a failed plot is moved back, never removed.
//   retryMs 6 h        the project's own wait after a failed siting is 30 min (skills.mjs COTTAGE_NOSITE_MS) and a town offers ten
//                      plots at most (eight homes, two free extension plots): one full rotation is 5 h, so a plot returns BY TIME only
//                      after every other plot has had its turn; the ground it failed on (trees, a grade, a neighbour's reservation)
//                      changes over hours, not minutes -- the stuck-cell rule's own back-off (shop.mjs SHOP_STUCK_RETRY_MS, 6 h).

import fs from 'node:fs'

/** widens: how far the approved pad is widened on every side, the first that can be placed (11 x 11, then 9 x 9); pad / ring: the
 *  cottage's square pad and its stand ring; minSide: the least plot side a cottage opens on (cottage.mjs cottageOpening); shiftMax: how
 *  far a plot may move off a reservation; pathGap: how far round a reserved plot the paths' router keeps (paths.mjs pathZones' own margin:
 *  a path's reservation is its columns + 1, so a path one column from the box would push the plot); retryMs: how long a failed plot stays behind the others; rowMs: one bot repeats a `_homeplot` row at most
 *  this often (geoRowMs for `shifted` and `skipped`: where a plot lies changes only when a record does); base: the cottage projects a
 *  town has without a layout. */
export const HOMEPLOT = Object.freeze({ v: 1, widens: Object.freeze([2, 1]), pad: 7, ring: 1, pathGap: 1, minSide: 9, shiftMax: 4, retryMs: 6 * 60 * 60_000, rowMs: 10 * 60_000, geoRowMs: 6 * 60 * 60_000, kind: 'house', base: 3 })

const onOff = v => { const s = String(v ?? '').trim().toLowerCase(); return ['on', '1', 'true', 'yes'].includes(s) ? true : ['off', '0', 'false', 'no'].includes(s) ? false : null }
/** THE SWITCH -> { on }. HOMEPLOTS=on|off; unset = on only in HOMEPLOTS_POOLS (default 'showcase'). Pure. */
export function homePlotsSwitches (env = process.env, pool = '') {
  const pools = String(env?.HOMEPLOTS_POOLS ?? 'showcase').split(',').map(s => s.trim()).filter(Boolean)
  return { on: onOff(env?.HOMEPLOTS) ?? pools.includes(String(pool)) }
}

const ok4 = b => Array.isArray(b) && b.length === 4 && b.every(Number.isInteger) && b[2] >= b[0] && b[3] >= b[1]
/**
 * THE LAYOUT'S HOME PLOTS for a town -> [{ id: 'H<n>', kind: 'house', layout: true, pad: [x0, z0, x1, z1], box }] | []. Pure. `data` the
 * parsed townlayout.json; the entry is the POOL's and only while its `home` IS the town's home (a pool re-homed to another world has no
 * layout); `pad` the approved box, `box` the pad widened by `widen` on every side (the first of HOMEPLOT.widens: where it is drawn). A
 * box that is not four whole numbers in order is left out (its number is not reused: the ids are the file's positions).
 */
export function layoutPlotsOf (data, pool, home, { widen = HOMEPLOT.widens[0] } = {}) {
  const e = data?.pools?.[String(pool ?? '')]
  if (!e || !home || e.home?.x !== home.x || e.home?.y !== home.y || e.home?.z !== home.z) return []
  const out = []
  ;(Array.isArray(e.homes) ? e.homes : []).forEach((b, i) => {
    if (ok4(b)) out.push({ id: `H${i + 1}`, kind: HOMEPLOT.kind, layout: true, pad: [...b], box: [b[0] - widen, b[1] - widen, b[2] + widen, b[3] + widen] })
  })
  return out
}
/** townlayout.json as it is on disk -> the parsed file | null (missing, unreadable). Never throws. */
export function readTownLayout (url = new URL('./townlayout.json', import.meta.url)) {
  try { return JSON.parse(fs.readFileSync(url, 'utf8')) } catch { return null }
}
/**
 * WHAT THIS PROCESS'S TOWN HAS -> { sw, on, pool, home, layout }. `sw` the switch; `layout` the town's plots WHATEVER the switch (a
 * cottage sited on one stays guarded after HOMEPLOTS=off: COTTAGE_PLOTS_GUARD); `on` = the switch AND a layout (a town with no entry
 * behaves as before). The pool and the home are read as config.mjs reads them (MEMORY_POOL, HOME_X/Y/Z, defaults 0, 70, 0).
 */
export function homePlotsAtLoad (env = process.env, data = readTownLayout()) {
  const pool = String(env?.MEMORY_POOL ?? '')
  const home = { x: Number(env?.HOME_X ?? '0'), y: Number(env?.HOME_Y ?? '70'), z: Number(env?.HOME_Z ?? '0') }
  const layout = layoutPlotsOf(data, pool, home)
  const sw = homePlotsSwitches(env, pool).on
  return { sw, on: sw && layout.length > 0, pool, home, layout }
}
const freezeDeep = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) freezeDeep(v) } return o }
export const HOMEPLOTS = freezeDeep(homePlotsAtLoad())

// ---- THE COTTAGE PROJECTS' NAMES --------------------------------------------------------------------------------------------
/** The cottage projects of a town with `n` layout homes -> ['cottage1', ..., 'cottage<max(3, n)>'] (frozen). Pure. Three without a
 *  layout, as before homes-01show; one a home with one (the owner's "yes": eight in the showcase). */
export const cottagePlotNames = (n = 0) => Object.freeze(Array.from({ length: Math.max(HOMEPLOT.base, Math.floor(Number(n)) || 0) }, (_, i) => `cottage${i + 1}`))
/** The town's cottage projects (cottage.mjs COTTAGE_PLOTS; shop.mjs PROJECTS; the tidy's, the stands' and the glass's plot lists): by
 *  the LAYOUT, whatever the switch -- HOMEPLOTS=off stops a later home being offered or sited (laterHomeHeld), never a sited one's
 *  place in the order or its protection. Three in a town with no layout. */
export const COTTAGE_NAMES = cottagePlotNames(HOMEPLOTS.layout.length)
/** Is this one of the homes the layout added (cottage4 ..)? Pure. */
export const isLaterHome = (plot, names = COTTAGE_NAMES) => names.indexOf(String(plot ?? '')) >= HOMEPLOT.base
/** IS AN UNSITED COTTAGE HELD BY THE SWITCH? -> bool. Pure. HOMEPLOTS off: a later home with no record is never opened and never sited
 *  (skills.mjs cottageOpenNow / cottageSiteFor ask only for a project with NO record: a sited one is past both). */
export const laterHomeHeld = (plot, on = HOMEPLOTS.on, names = COTTAGE_NAMES) => !on && isLaterHome(plot, names)
/**
 * DOES THIS LATER HOME WAIT ON THE COTTAGE BEFORE IT, WITHOUT A READ? -> bool. Pure. The cottages are chained (`after`: each after the
 * one before stands) and shop.mjs activeProject offers an open project only when its `after` is complete -- so in the order's status
 * pass (skills.mjs shopActive) a LATER HOME (cottage4 .., the ones the layout added: isLaterHome) whose predecessor's state in THIS
 * pass is not complete reports `waiting` from the chain alone, and neither its record nor the town's (the offer reads every record)
 * is read for it.
 *   p     the PROJECTS entry ({ plot, after });   done  Map plot -> complete, the cottages' states already computed this pass
 * A predecessor not in `done` (never computed here) answers false: the project is read as before.
 *
 * ONLY THE LATER HOMES (review r2, Codex: the first shape took every cottage, and changed a town with NO layout -- cottage1 standing,
 * cottage2 sited and held on `leaf_decay` / `zone_closed`, cottage3 unsited with a free plot: activeProject's last fallback, "the last
 * project not waiting", took cottage3 at the base and the complete cottage1 with cottage3 newly `waiting`). The first three cottages
 * are read and answered EXACTLY as the base in every town -- no layout, a layout, the switch on or off -- so the rollback is exact
 * for them too (a rule keyed on the layout's presence alone would still change them in the showcase with HOMEPLOTS off). A town with
 * no layout has no later home: nothing here ever answers true there.
 * WHAT THE PICK DOES IN THAT SEQUENCE IN A TOWN WITH A LAYOUT:
 *   cottage2 held, cottage3 unsited   the base's pick, unchanged: cottage4 .. wait behind cottage3, the fallback takes cottage3 (not
 *                                     waiting), and the order answers a `build_shop` visit that sites it.
 *   cottage4 held, cottage5 unsited   (the same one step on, among the later homes) cottage5 .. wait from the chain, so the fallback
 *                                     takes the last project that stands -- cottage3, complete; the order answers no order, skip
 *                                     `complete`, and the grounds are asked in its place (grounds2.mjs NO_ORDER_SKIPS) -- where a
 *                                     fifth home sited ahead of an unfinished fourth would have been the base rule's answer.
 * THE COST of keeping the first three as they were: cottage3 behind an unfinished cottage2 still costs one read of the town's records
 * a pass, as it does at the base; the five later homes cost none.
 */
export const chainWaits = (p, done, names = COTTAGE_NAMES) => isLaterHome(p?.plot, names) && names.includes(String(p?.after ?? '')) && done instanceof Map && done.has(p.after) && done.get(p.after) !== true

// ---- THE PLOTS AMONG THE TOWN'S RESERVATIONS --------------------------------------------------------------------------------
const meets = (b, q) => b[0] <= q[2] && b[2] >= q[0] && b[1] <= q[3] && b[3] >= q[1]
const zoneBox4 = z => (Array.isArray(z?.box) && z.box.length === 6 && z.box.every(Number.isFinite) ? [z.box[0], z.box[2], z.box[3], z.box[5]] : null)
const isRoad = why => /^land:road/.test(String(why ?? ''))
/** The offsets a plot is tried at, nearest first -> [[dx, dz]] (never [0, 0]). Pure and deterministic: by distance, then by the fewer
 *  blocks moved, then z before x, the negative first. */
export function shiftOffsets (max = HOMEPLOT.shiftMax) {
  const out = []
  for (let dx = -max; dx <= max; dx++) for (let dz = -max; dz <= max; dz++) if (dx || dz) out.push([dx, dz])
  return out.sort((a, b) => (a[0] * a[0] + a[1] * a[1]) - (b[0] * b[0] + b[1] * b[1]) || (Math.abs(a[0]) + Math.abs(a[1])) - (Math.abs(b[0]) + Math.abs(b[1])) || a[1] - b[1] || a[0] - b[0])
}
/**
 * CAN A COTTAGE'S DOOR FACE HOME FROM INSIDE THIS BOX? -> bool. Pure: buildsite.mjs facesHome's rule for a square pad whose door is
 * the middle of its front (every cottage@1 and the square cottage@2 looks). Every pad position that keeps its `ring` inside the box,
 * every side the front may be on: the door's side must be the cardinal nearest the door -> home line (a tie goes to x, as facesHome's).
 */
export function homeFacing (box, home, { pad = HOMEPLOT.pad, ring = HOMEPLOT.ring } = {}) {
  if (!ok4(box) || !home) return false
  const mid = (pad - 1) / 2
  for (let x0 = box[0] + ring; x0 + pad - 1 <= box[2] - ring; x0++) {
    for (let z0 = box[1] + ring; z0 + pad - 1 <= box[3] - ring; z0++) {
      for (const [dx, dz, nx, nz] of [[0, mid, -1, 0], [pad - 1, mid, 1, 0], [mid, 0, 0, -1], [mid, pad - 1, 0, 1]]) {
        const tx = home.x - (x0 + dx), tz = home.z - (z0 + dz)
        const want = Math.abs(tx) >= Math.abs(tz) ? [Math.sign(tx), 0] : [0, Math.sign(tz)]
        if (want[0] === nx && want[1] === nz) return true
      }
    }
  }
  return false
}
/**
 * THE LAYOUT'S PLOTS PLACED AMONG THE TOWN'S RESERVATIONS -> one entry a plot, in order: the plot as drawn ({ ...plot, shift: [0, 0] }),
 * the plot moved or narrowed ({ ...plot, box, pad, shift: [dx, dz], why }) or the plot skipped ({ ...plot, skip: why }). Pure and
 * deterministic.
 *   zones   shop.mjs recordZones' shape [{ box: [x0, y0, z0, x1, y1, z1], why, id? }] -- every record's zone and the land plan's
 *           reservation (its `land:road` corridors, park, garden, landmark, the extension's plots). A zone is taken at every height.
 *           The layout's OWN zones (`land:plot` with a layout id: skills.mjs projectHeads adds them from this answer) are left out.
 *   home    the town's home (homeFacing); none given: the door is not judged
 * A plot stays where it is drawn when its box meets no zone and no sibling and takes a home-facing pad. Else, for each width of
 * `widens` in turn, every offset within `max`, nearest first (the drawn place first), and the first whose box clears every zone, every
 * plot placed before it and every later plot as drawn, and takes a home-facing pad. None: `road_no_shift` when a road corridor was
 * among what the drawn box met, else `blocked:<why>` (a record sits on it: a cottage's own zone is its pad + 3, which no shift of 4
 * clears; or ornaments' zones leave no room), else `door_no_shift`.
 */
export function resolveHomePlots (layout = [], zones = [], { home = null, max = HOMEPLOT.shiftMax, widens = HOMEPLOT.widens } = {}) {
  const ids = new Set(layout.map(p => String(p.id)))
  const grow = (b, m) => [b[0] - m, b[1] - m, b[2] + m, b[3] + m]
  const reach = max + Math.max(...widens) + 1
  const zs = []
  for (const z of zones ?? []) {
    if (String(z?.why ?? '') === 'land:plot' && ids.has(String(z?.id ?? ''))) continue
    const b = zoneBox4(z)
    if (b && layout.some(p => meets(grow(p.pad, reach), b))) zs.push({ b, why: String(z.why ?? 'zone') })
  }
  const offs = [[0, 0], ...shiftOffsets(max)]
  const placed = []
  return layout.map((p, i) => {
    const sibs = [...placed, ...layout.slice(i + 1).map(q => q.box)]
    const clear = b => !zs.some(z => meets(b, z.b)) && !sibs.some(q => meets(b, q))
    const faces = b => !home || homeFacing(b, home)
    if (clear(p.box) && faces(p.box)) { placed.push(p.box); return { ...p, shift: [0, 0] } }
    const hits = zs.filter(z => meets(p.box, z.b))
    const road = hits.some(z => isRoad(z.why))
    const why = road ? 'road' : hits[0]?.why ?? (clear(p.box) ? 'door' : 'plot')
    for (const w of widens) {
      for (const [dx, dz] of offs) {
        const pad = [p.pad[0] + dx, p.pad[1] + dz, p.pad[2] + dx, p.pad[3] + dz]
        const b = grow(pad, w)
        if (!clear(b) || !faces(b)) continue
        placed.push(b)
        return { ...p, box: b, pad, shift: [dx, dz], why }
      }
    }
    return { ...p, skip: road ? 'road_no_shift' : why === 'door' ? 'door_no_shift' : `blocked:${why}` }
  })
}
/** The placed plots as the land plan's reservation zones (landplan.mjs landPlotZones' shape: `land:plot`, the plot's id) -> [zone].
 *  Pure. A skipped plot reserves nothing (what it met already does). */
export const homePlotZones = (resolved = []) => resolved.filter(p => !p.skip && ok4(p.box)).map(p => ({ box: [p.box[0], -64, p.box[1], p.box[2], 320, p.box[3]], why: 'land:plot', id: String(p.id) }))

/** WHICH RESERVED HOME PLOT IS THIS COLUMN IN? -> (x, z) -> the plot's id | null. Pure. `resolved` resolveHomePlots' answer (a skipped
 *  plot reserves nothing); `margin` blocks round the box. The groundskeeper's PERMANENT sitings ask it (the landmark mound, a new park:
 *  skills.mjs tidyInputs `homePlot`) -- its own refusals never read the land plan's reservation, so that the plots are still tidied. */
export function homePlotAt (resolved = [], margin = 0) {
  const bs = (resolved ?? []).filter(p => p && !p.skip && ok4(p.box)).map(p => [String(p.id), p.box[0] - margin, p.box[1] - margin, p.box[2] + margin, p.box[3] + margin])
  return (x, z) => { for (const b of bs) if (x >= b[1] && x <= b[3] && z >= b[2] && z <= b[4]) return b[0]; return null }
}
/**
 * THE PATHS' ROUTER KEEPS OFF A RESERVED HOME (review r1, Codex: paths.mjs pathAvoid reads a record's CELLS, and the reservation is
 * only the land pseudo-record's zones -- a path could be published across a plot, which then read `blocked:project:paths`) -> the
 * router's inputs with every placed plot's box + HOMEPLOT.pathGap among its `zones` (pathAvoid's `zone` refusal: a leg goes round, a
 * destination is still reached from outside). Pure. No placed plot (HOMEPLOTS off, no layout): THE SAME OBJECT, exactly as before.
 * Only the router's inputs (skills.mjs buildPaths, pathsExtendDue): the tidy, the wall and the farms read pathsInputs unchanged.
 */
export function pathInputsWithHomes (P, resolved = null, margin = HOMEPLOT.pathGap) {
  const zs = homePlotZones(resolved ?? []).map(z => ({ box: [z.box[0] - margin, z.box[1], z.box[2] - margin, z.box[3] + margin, z.box[4], z.box[5] + margin], why: z.why, id: z.id }))
  return zs.length ? { ...P, zones: [...(P?.zones ?? []), ...zs] } : P
}

// ---- THE ROTATION --------------------------------------------------------------------------------------------------------------
/** A plot's failure inside the wait -> its stamp | null. A stamp from the future (a clock that jumped) is no failure: it could never age. */
const recentFail = (fails, id, now, retryMs) => { const at = Number(fails?.[id]?.at); return Number.isFinite(at) && at <= now + 60_000 && now - at < retryMs ? at : null }
/** THE ORDER THE PLOTS ARE TRIED IN -> [plot]. Pure. Every plot with no failure inside `retryMs` first, in the order given; then the
 *  failed ones, the oldest failure first (ties in the order given). Nothing is dropped. */
export function rotatePlots (plots = [], fails = {}, now = Date.now(), retryMs = HOMEPLOT.retryMs) {
  const fresh = plots.filter(p => recentFail(fails, p.id, now, retryMs) == null)
  const failed = plots.map((p, i) => ({ p, i, at: recentFail(fails, p.id, now, retryMs) })).filter(x => x.at != null).sort((a, b) => a.at - b.at || a.i - b.i).map(x => x.p)
  return [...fresh, ...failed]
}
/** The memory with one more failure -> { id: { at, why, n, project, by } } (a new object). Pure. Entries older than `retryMs` are
 *  dropped (they order nothing); `n` counts a plot's failures while it stays remembered. */
export function failNoted (fails = {}, id, { why = '', project = '', by = '', now = Date.now(), retryMs = HOMEPLOT.retryMs } = {}) {
  const out = {}
  for (const [k, f] of Object.entries(fails ?? {})) if (recentFail(fails, k, now, retryMs) != null) out[k] = f
  out[String(id)] = { at: now, why: String(why ?? '').slice(0, 60), n: (Number(out[String(id)]?.n) || 0) + 1, project: String(project ?? ''), by: String(by ?? '') }
  return out
}
/**
 * THE HOUSE PLOTS OFFERED TO A COTTAGE NOW -> { plots, skipped: [{ id, why }], why }. Pure.
 *   layout  resolveHomePlots' answer (the layout's plots FIRST); ext  the wall extension's record (its `house` plots after them, as
 *           they were offered before); taken  the plot ids other records hold; fails  the per-plot memory
 * NOT FREE: a layout plot skipped by resolveHomePlots (its reason), a plot another record holds (`taken`), a plot under `minSide` on a
 * side (`plot_<w>x<d>`: cottageOpening would refuse it and wait on it for good). The free plots in rotatePlots' order. `why` when
 * none: `no_extension` only with neither a layout nor an extension, else `no_house_plot` (the project WAITS: skills.mjs plot_wait).
 */
export function houseOffer ({ layout = [], ext = null, taken = [], fails = {}, now = Date.now(), minSide = HOMEPLOT.minSide, retryMs = HOMEPLOT.retryMs } = {}) {
  const skipped = [], cands = []
  for (const p of layout ?? []) { if (p?.skip) skipped.push({ id: p.id, why: p.skip }); else if (ok4(p?.box)) cands.push(p) }
  const okBox = b => Array.isArray(b) && b.length === 4 && b.every(Number.isFinite)
  for (const p of ext?.plots ?? []) if (p?.kind === HOMEPLOT.kind && okBox(p.box)) cands.push(p)
  const held = new Set((taken ?? []).map(String))
  const free = []
  for (const p of cands) {
    if (held.has(String(p.id))) { skipped.push({ id: p.id, why: 'taken' }); continue }
    const w = p.box[2] - p.box[0] + 1, d = p.box[3] - p.box[1] + 1
    if (Math.min(w, d) < minSide) { skipped.push({ id: p.id, why: `plot_${w}x${d}` }); continue }
    free.push(p)
  }
  const plots = rotatePlots(free, fails, now, retryMs)
  return { plots, skipped, why: plots.length ? 'ok' : (!ext && !(layout ?? []).length ? 'no_extension' : 'no_house_plot') }
}

// ---- THE SITING OVER THE OFFERED PLOTS -----------------------------------------------------------------------------------------
/** A failed siting whose reason is the TOWN's, not the plot's: no plot is marked failed and no other plot is tried this visit (the
 *  visit ended, the stock is not known yet, no wood to build from, a record published during the search). */
export const TOWN_WHYS = Object.freeze(['aborted', 'stock_unknown', 'no_wood', 'site_taken'])
/**
 * SITE ON THE FIRST PLOT THAT TAKES THE BUILDING -> siteOne's answer for it ({ ok: true, ..., plotId }) | the last failure. Never
 * throws (a throw of `siteOne` is that plot's failure, `error`).
 *   plots     houseOffer's, in order            siteOne(plot) -> { ok, why, ... }   the building's own siting on ONE plot
 *   left()    ms left of the visit's ONE search box (buildsite.mjs siteBox): a plot is tried only while some is left
 *   noteFail(plot, why)   the per-plot memory's writer            row({ op, plot, why })   the `_homeplot` row's writer
 * A plot that fails for its own reason (no site, no proven site, a too-long search, an error) is noted and the NEXT plot is tried in
 * the same visit; `search_time` ends the visit's siting (the box is spent) with the plot noted, so the next visit starts at another.
 */
export async function siteOverPlots (plots = [], siteOne, { left = () => Infinity, noteFail = () => {}, row = () => {} } = {}) {
  let last = null
  for (const p of plots) {
    if (!(left() > 0)) break
    row({ op: 'chosen', plot: p.id })
    let r = null
    try { r = await siteOne(p) } catch (e) { r = { ok: false, why: 'error', detail: String(e?.message ?? e).slice(0, 60) } }
    if (r?.ok) return { ...r, plotId: p.id }
    last = r ?? { ok: false, why: 'error' }
    if (TOWN_WHYS.includes(last.why)) return last
    try { noteFail(p, last.why) } catch { /* no memory: the next attempt starts here again */ }
    row({ op: 'failed', plot: p.id, why: last.why })
    if (last.why === 'search_time') return last
  }
  return last ?? { ok: false, why: 'search_time' }
}

// ---- THE ROWS ------------------------------------------------------------------------------------------------------------------
/** One `_homeplot` row's detail: `project=... op=offered|skipped|shifted|chosen|failed plot=... why=...`. Pure. */
export function homePlotRowDetail (f = {}) {
  return Object.entries({ project: f.project, op: f.op, plot: f.plot, why: f.why, shift: f.shift, box: f.box, plots: f.plots, n: f.n, skipped: f.skipped })
    .filter(([, v]) => v != null).map(([k, v]) => `${k}=${String(Array.isArray(v) ? v.join(',') : v).replace(/\s+/g, '_').slice(0, k === 'plots' ? 80 : 60)}`).join(' ')
}
/** IS THIS ROW DUE for this bot? -> bool (and the memo is stamped). The same project, op, plot and reason at most every `everyMs`:
 *  HOMEPLOT.rowMs, and geoRowMs for `shifted` / `skipped` (the 30-min wait after a failed siting already spaces the visits; this
 *  bounds the rows that say the same thing at every one of them). */
export function homeRowDue (memo, f = {}, now = Date.now(), everyMs = f.op === 'shifted' || f.op === 'skipped' ? HOMEPLOT.geoRowMs : HOMEPLOT.rowMs) {
  const sig = `${f.project ?? ''}|${f.op ?? ''}|${f.plot ?? ''}|${f.why ?? ''}|${Array.isArray(f.plots) ? f.plots.join(',') : ''}`
  const last = memo.get(sig)
  if (Number.isFinite(last) && now - last < everyMs && now >= last) return false
  memo.set(sig, now)
  if (memo.size > 256) for (const [k, at] of memo) if (now - at >= HOMEPLOT.geoRowMs) memo.delete(k)
  return true
}
/** The licence row's detail (features.mjs `_homeplots_mode`: on=0 under HOMEPLOTS=off or in a town with no layout; `later`: whether a
 *  later home is opened unsited, or only finished once sited). Pure. */
export const homePlotsModeDetail = (h = HOMEPLOTS, names = cottagePlotNames(h.layout.length)) => `on=${h.on ? 1 : 0} switch=${h.sw ? 1 : 0} plots=${h.layout.length} projects=${names.length} later=${h.layout.length <= HOMEPLOT.base ? 'none' : h.on ? 'open' : 'sited_only'} shift=${HOMEPLOT.shiftMax} retry_h=${HOMEPLOT.retryMs / 3_600_000}`
