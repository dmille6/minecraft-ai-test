// PLANAHEAD-01 (OWNER 11-09 "do 1,2,3": idea #4 + #5 of docs/reports/minecraft-ai-landscape-2026-11-09.md; design
// docs/reports/planahead-design-2026-11-09.md, Codex + independent Claude, reconciled). PLAN THE TOWN AHEAD: work the town plans is
// checked for reach WHEN IT IS PLANNED, with the town's own walk model (buildsite.mjs walkFrom / stepFor, buildrun.mjs digStand), so a
// stage or a building that cannot be finished is known before a block is placed -- instead of being found stuck and waived afterwards
// (stuckclose, stuckfleet, gkclear, gkleft, stallWaive: every one retroactive).
//
// MEASURED 11-09 (read-only replay of the showcase's region copy, the bots' own walk, 35,016 stood seeds): of the in-wall tidy stage's
// 1,327 open fills and 544 open cuts, 88 fills and 7 cuts are reached by NO order of work (5%) -- the stage waits on waivers for them;
// the tower 19 of 150, the stepwell 10 of 1,579. Since 95% of the stage IS reachable, this is the closing problem, not the crew's idle
// time (that is walk and draw time: another piece).
//
// WHAT IT DOES (pure; skills.mjs wires it; PLANAHEAD=off is the one-setting rollback):
//   1. planReach / planReachSteps -- THE PLAN-TIME CHECK: the open cuts and fills worked in any order to a fixed point in the town's
//      walk (a cut dug when a dig stand sees it, a fill placed when a step reaches it, the world overlaid as it goes), against a
//      PESSIMISTIC planned world: other records' open work may only take stands away (their open solid cells are obstacles and never
//      floors, their open cuts are never floors), never add them (both reviews' B1: no imaginary floors). Cooperative (a generator),
//      bounded (passes, budget); an unfinished search is `unchecked` -- it tags NOTHING (fail open: the stage publishes as today).
//   2. reachTag -- the record carries `reach` = { v, at, state, open, pu, passes, checked, ms }: `pu` (plan-unreached) keys are a TAG,
//      never a waiver (Claude B3: a plan negative alone never drops work). A tag share over PA.suspect is not believed: no tags.
//   3. puWaiveDue -- a tagged cell a live visit ALSO could not reach (it deferred it, or ran out of work leaving it) is waived at once,
//      under the stage's existing waiver share: two independent negatives instead of three visits' worth of one.
//   4. puSupply -- a HELPER's view of the stage without the tagged cells (the keeper confirms them): a helper draws material and walks
//      only for work some order reaches -- the crew's supply, counted (supplyOf) for the effect metric.
//   5. standClaims / standRetire / standConflicts -- A BUILDING'S STANDS ARE ITS CLAIM: a sited, unfinished building's proof stands
//      (feet + head must stay passable, the floor below must stay) are retired from the tidy's record like claim-01's volume (never a
//      refusal the tidy waits on: CLAUDE.md's two-guards dead end), and a new building candidate that would fill another open
//      building's stand or dig its floor is not proven (`stand_claimed`: the search moves on to the next anchor).
//   6. plannedWorld -- the planned obstacles of other open HARD records (buildings, walls, paths, sinks; never the soft tidy and land
//      plan, Claude B2) for a building's proof (buildsite.mjs proveSite `planned`).
import { walkFrom, stepFor, overlay } from './buildsite.mjs'
import { digStand } from './buildrun.mjs'

export const PA = Object.freeze({
  walkR: 104,          // the tidy's walk radius (the in-wall stage reaches 88 from home; + a stand's reach)
  passes: 8,           // re-walks of the fixed point (the showcase's stage: 5)
  budgetMs: 20_000,    // the check's wall-clock budget inside a 180 s visit; past it the stage publishes untagged
  sliceMs: 40,         // the event loop handed back this often (siteBlueprintAsync's slice)
  suspect: 0.15,       // a tag share above this is a wrong walk, not a dead stage (the replay: 5%): no tags ...
  suspectMin: 24,      // ... once more than this many are tagged (a stage's last few dead cells are often ALL its open work:
                       // fleet hive-a 11-09, 7 of 7 open cuts reached by no order; board-b 1 of 1 fill)
  waiveMax: 12,        // tagged cells waived in one visit (gkwork GKL.leftMax)
  share: 0.25,         // the stage's waived total at most this share of its cells + clears (gkwork GKW.stallShare)
})
/** THE SWITCH -> bool. PLANAHEAD=off|0|false|no: off; default on. Pure. */
export const planaheadOn = (env = process.env) => !['off', '0', 'false', 'no'].includes(String(env?.PLANAHEAD ?? '').trim().toLowerCase())

const k3 = (x, y, z) => `${x},${y},${z}`
const kOf = a => k3(a[0], a[1], a[2])
const AIR = Object.freeze({ name: 'air', boundingBox: 'empty' })
const PUT = Object.freeze({ name: 'cobblestone', boundingBox: 'block' })
const LIT = Object.freeze({ name: 'torch', boundingBox: 'empty' })
const okAt = a => Array.isArray(a) && a.length === 3 && a.every(Number.isFinite)
const byColumn = keys => {
  const m = new Map()
  for (const key of keys) { const [x, y, z] = key.split(',').map(Number); const c = `${x},${z}`; if (!m.has(c)) m.set(c, []); m.get(c).push(y) }
  return m
}
/** A cell's box once placed: a light (a torch, a lantern) is passable, everything else a block. Pure. */
export const placedBox = role => (/(^|-)light$/.test(String(role ?? '')) ? 'empty' : 'block')

/**
 * THE PLAN-TIME CHECK, as a generator (yields between passes and every few cells) -> its return value
 * { state: 'proven' | 'unchecked', open: { fills, cuts }, pu: [key], passes, checked }. Pure over `read`.
 *   fills  [{ at, role }]   the OPEN fill cells (the caller's own done rule decided which)
 *   cuts   [[x, y, z]]      the OPEN cuts and clears (standing blocks)
 *   ctx    { home, stood, walkR, planned: { block: Set, noFloor: Set }, passes, deadline(now) -> bool, now() }
 * `proven`: a fixed point was reached; `pu` = the open cells no order reached. `unchecked`: the passes or the budget ran out first;
 * `pu` is then EMPTY (an unfinished search proves nothing -- Codex: unproven is not impossible).
 */
export function * planReachSteps (read, fills = [], cuts = [], ctx = {}) {
  const home = ctx.home
  const walkR = Number.isFinite(ctx.walkR) ? ctx.walkR : PA.walkR
  const maxPasses = Number.isFinite(ctx.passes) ? ctx.passes : PA.passes
  // Codex r1 BLOCKER 2: an UNKNOWN read anywhere the search looked (a floor, a head, a route, a sight line -- not only the work cells)
  // can hide a stand: a search that met one proves no negative (it ends `unchecked`, tags nothing)
  let unknown = 0
  const read0 = (x, y, z) => { const b = read(x, y, z); if (!b) unknown++; return b }
  const over = new Map(), R = overlay(read0, over)
  const planned = ctx.planned ?? {}
  const pBlock = planned.block instanceof Set ? planned.block : new Set()
  const pNoFloor = planned.noFloor instanceof Set ? planned.noFloor : new Set()
  let F = (fills ?? []).filter(f => okAt(f?.at)).map(f => ({ at: f.at, box: placedBox(f.role) }))
  let C = (cuts ?? []).map(c => (okAt(c?.at) ? c.at : c)).filter(okAt)
  const open = { fills: F.length, cuts: C.length }
  if (!home || (!F.length && !C.length)) return { state: 'proven', open, pu: [], passes: 0, checked: 0 }
  let checked = 0, passes = 0
  // the walk: the fills still to place are obstacles and never floors (a stand may not rely on a block that is not there), with the
  // other records' planned obstacles; their open cuts are never floors
  const walk = () => {
    const block = new Set(pBlock)
    for (const f of F) if (f.box === 'block') block.add(kOf(f.at))
    return byColumn(walkFrom(R, home, block, walkR, { stood: ctx.stood ?? [], noFloor: pNoFloor.size ? pNoFloor : null }))
  }
  let nodes = walk()
  for (;;) {
    if (ctx.deadline?.()) return { state: 'unchecked', open, pu: [], passes, checked, why: 'budget' }
    passes++
    let progress = false
    const leftC = []
    for (let i = 0; i < C.length; i++) {
      if ((i & 31) === 31) yield null
      checked++
      if (digStand(R, C[i], nodes)) { over.set(kOf(C[i]), AIR); progress = true } else leftC.push(C[i])
    }
    C = leftC
    F.sort((a, b) => a.at[1] - b.at[1])
    const leftF = []
    for (let i = 0; i < F.length; i++) {
      if ((i & 31) === 31) yield null
      checked++
      const f = F[i]
      if (stepFor(R, home, f.at, nodes, () => true)) { over.set(kOf(f.at), f.box === 'block' ? PUT : LIT); progress = true } else leftF.push(f)
    }
    F = leftF
    if (!progress || (!F.length && !C.length)) {
      const pu = [...F.map(f => kOf(f.at)), ...C.map(kOf)]
      if (pu.length && unknown > 0) return { state: 'unchecked', open, pu: [], passes, checked, why: `unknown:${unknown}` }
      return { state: 'proven', open, pu, passes, checked }
    }
    if (passes >= maxPasses) return { state: 'unchecked', open, pu: [], passes, checked, why: 'passes' }
    yield null
    nodes = walk()
  }
}
/** planReachSteps straight through (tests, offline) -> its result. Pure. */
export function planReach (read, fills, cuts, ctx = {}) {
  const g = planReachSteps(read, fills, cuts, ctx)
  for (;;) { const r = g.next(); if (r.done) return r.value }
}
/** planReachSteps COOPERATIVELY (the event loop back every `sliceMs`; `budgetMs` of wall clock, then `unchecked`) -> Promise. */
export async function planReachAsync (read, fills, cuts, ctx = {}, { sliceMs = PA.sliceMs, budgetMs = PA.budgetMs, aborted = () => false } = {}) {
  const t0 = Date.now()
  const g = planReachSteps(read, fills, cuts, { ...ctx, deadline: () => Date.now() - t0 > budgetMs || aborted() })
  let t = Date.now()
  for (;;) {
    const r = g.next()
    if (r.done) return { ...r.value, ms: Date.now() - t0 }
    if (Date.now() - t >= sliceMs) { await new Promise(resolve => setImmediate(resolve)); t = Date.now() }
  }
}

/**
 * THE RECORD'S REACH TAG -> the `reach` field. Pure. A proven check tagging more than PA.suspectMin cells AND over PA.suspect of the open work is
 * `suspect` and tags nothing (the replay's dead share is 5%: a third of a stage "unreachable" is a wrong seed or walk, never believed).
 */
export function reachTag (r, { now = Date.now(), suspect = PA.suspect, suspectMin = PA.suspectMin } = {}) {
  const open = (r?.open?.fills ?? 0) + (r?.open?.cuts ?? 0)
  const pu = Array.isArray(r?.pu) ? r.pu : []
  let state = r?.state === 'proven' ? 'proven' : 'unchecked'
  if (state === 'proven' && open > 0 && pu.length > suspectMin && pu.length / open > suspect) state = 'suspect'
  return { v: 1, at: now, state, open, pu: state === 'proven' ? pu : [], n: pu.length, passes: r?.passes ?? 0, checked: r?.checked ?? 0, ms: r?.ms ?? null }
}
/** The record's tagged keys -> Set. Pure. Only a `proven` tag counts. */
export const puKeys = rec => new Set(rec?.reach?.state === 'proven' && Array.isArray(rec.reach.pu) ? rec.reach.pu : [])

/**
 * THE TAGGED CELLS A LIVE VISIT ALSO MISSED AND A FRESH CHECK CONFIRMS, waived now -> [{ k, why }]. Pure. `missed` = keys this visit deferred (no stand) or left
 * open when it ran out of work. Only a record cell or clear (what the waived map is read for: never a cut). Never a fill that names its opener (roughground-1b: a hollow under a crust), never one waived already;
 * at most PA.waiveMax a visit and the stage's waived total at most ceil(PA.share * (cells + clears)) -- the room gkwork's waivers share.
 */
export function puWaiveDue (rec, missed = [], { already = [], confirm = () => false, P = PA } = {}) {
  const pu = puKeys(rec)
  if (!pu.size) return []
  const have = rec?.waived ?? {}
  const size = (rec?.cells ?? []).length + (rec?.clear ?? []).length
  const taken = new Set((already ?? []).map(d => String(d?.k ?? d)))
  let room = Math.min(P.waiveMax, Math.ceil(P.share * size) - Object.keys(have).length - taken.size)
  const sealed = new Set((rec?.cells ?? []).filter(c => c?.opener && okAt(c.at)).map(c => kOf(c.at)))
  // only what a waiver is READ for: a record cell or a clear (a waived CUT is read by no done rule -- it would spend the room for nothing)
  const waivable = new Set([...(rec?.cells ?? []), ...(rec?.clear ?? [])].filter(q => okAt(q?.at)).map(q => kOf(q.at)))
  const out = []
  for (const m of missed ?? []) {
    if (room <= 0) break
    const k = String(m?.k ?? m)
    if (!pu.has(k) || !waivable.has(k) || sealed.has(k) || taken.has(k) || Object.prototype.hasOwnProperty.call(have, k) || out.some(o => o.k === k)) continue
    // Codex r1 BLOCKER 1: a deferral may be transient (a body, attempts spent); the waiver needs a FRESH conclusive check now -- `confirm(k)`
    // true only when the live world, fully read, has no stand for it (liveUnreached); the default confirms nothing
    if (confirm(k) !== true) continue
    out.push({ k, why: 'plan_unreach' }); room--
  }
  return out
}

/**
 * THE FRESH CONCLUSIVE CHECK for the plan waiver -> (k) -> true (no stand now, every read known) | false. Pure over `read` (the bot's
 * live world). One walk, made on the first call; `fill(k)` says a key is a fill (a step must reach it) else a clear (a dig stand must
 * see it). An unknown read anywhere the check looked -> false for every key (never a waiver on a hole in the bot's knowledge).
 */
export function liveUnreached (read, home, { stood = [], walkR = PA.walkR, fill = () => true, block = new Set() } = {}) {
  let unknown = 0, nodes = null
  const R = (x, y, z) => { const b = read(x, y, z); if (!b) unknown++; return b }
  return k => {
    try {
      if (!nodes) nodes = byColumn(walkFrom(R, home, block, walkR, { stood }))
      const at = String(k).split(',').map(Number)
      if (!okAt(at)) return false
      const hit = fill(k) ? stepFor(R, home, at, nodes, () => true) : digStand(R, at, nodes)
      return !hit && unknown === 0
    } catch { return false }
  }
}
/** A HELPER's view of the stage without the tagged cells, cuts and clears (the keeper confirms them) -> rec. Pure. */
export function puSupply (rec) {
  const pu = puKeys(rec)
  if (!pu.size || !rec) return rec
  const keep = q => !(okAt(q?.at) && pu.has(kOf(q.at)))
  return { ...rec, cells: (rec.cells ?? []).filter(keep), cut: (rec.cut ?? []).filter(keep), clear: (rec.clear ?? []).filter(keep) }
}
/** THE SUPPLY for the row -> 'open/pu' | '-'. Pure. `openKeys` = the open fill and cut keys the visit read. */
export function supplyOf (rec, openKeys = []) {
  if (!rec?.reach) return '-'
  const pu = puKeys(rec)
  let n = 0, p = 0
  for (const k of openKeys ?? []) { n++; if (pu.has(k)) p++ }
  return `${n}/${p}${rec.reach.state === 'proven' ? '' : `:${rec.reach.state}`}`
}

// ---- stand claims -------------------------------------------------------------------------------------------------------------

/** The building plots whose open records claim their proof stands (claim-01's plots + the styled cottages). */
export const STAND_PLOTS = Object.freeze(['townhall', 'cottage1', 'cottage2', 'cottage3', 'enchantshop', 'hall', 'storehub', 'house1', 'shop', 'civicF', 'civicM', 'civicB', 'civicH', 'civicP', 'civicS', 'civicL'])   // citywall fold: civic.mjs CIVIC_PLOTS
/**
 * THE OPEN BUILDINGS' STAND CLAIMS -> { feet: Map key -> plot (feet and head: must stay passable), floor: Map key -> plot (must stay) }.
 * Pure. Only a record not structure_complete; only a cell not yet waived; the stand of each proof cell (proveSite's `stand`).
 */
export function standClaims (records = [], { plots = STAND_PLOTS } = {}) {
  const feet = new Map(), floor = new Map()
  for (const r of records ?? []) {
    if (!r || r.structure_complete || !plots.includes(String(r.plot ?? ''))) continue
    const waived = r.waived ?? {}
    for (const c of r.cells ?? []) {
      if (!okAt(c?.stand) || (okAt(c?.at) && Object.prototype.hasOwnProperty.call(waived, kOf(c.at)))) continue
      const [x, y, z] = c.stand
      feet.set(k3(x, y, z), r.plot); feet.set(k3(x, y + 1, z), r.plot); floor.set(k3(x, y - 1, z), r.plot)
    }
  }
  return { feet, floor }
}
/**
 * THE TIDY'S ENTRIES ON A CLAIMED STAND RETIRED -> the next generation | null (none). Pure. A fill on a claimed feet/head cell and a
 * cut or clear of a claimed floor leave the record (as claim-01's claimRetire: retired, never refused-and-waited -- the stage never
 * waits on a cell it may not work); replants stay; `standClaimed` notes the counts per plot.
 */
export function standRetire (rec, claims) {
  if (!rec || (!claims?.feet?.size && !claims?.floor?.size)) return null
  const fillGone = q => okAt(q?.at) && claims.feet.has(kOf(q.at))
  const digGone = q => okAt(q?.at) && claims.floor.has(kOf(q.at))
  const n = { cells: (rec.cells ?? []).filter(fillGone).length, cut: (rec.cut ?? []).filter(digGone).length, clear: (rec.clear ?? []).filter(digGone).length }
  if (!n.cells && !n.cut && !n.clear) return null
  const cells = (rec.cells ?? []).filter(q => !fillGone(q))
  const keepSeg = new Set(cells.map(q => q.seg))
  const note = { ...(rec.standClaimed ?? {}) }
  for (const q of (rec.cells ?? []).filter(fillGone)) { const p = claims.feet.get(kOf(q.at)); note[p] = (note[p] ?? 0) + 1 }
  for (const q of [...(rec.cut ?? []), ...(rec.clear ?? [])].filter(digGone)) { const p = claims.floor.get(kOf(q.at)); note[p] = (note[p] ?? 0) + 1 }
  return { ...rec, cells, segments: (rec.segments ?? []).filter(sg => keepSeg.has(sg.seg)), cut: (rec.cut ?? []).filter(q => !digGone(q)), clear: (rec.clear ?? []).filter(q => !digGone(q)), replant: rec.replant ?? [], standClaimed: note }
}
/**
 * A BUILDING CANDIDATE AGAINST THE OTHER OPEN BUILDINGS' STANDS -> null | { plot, at, kind }. Pure. A solid cell of the candidate (or
 * its fill) on a claimed feet/head cell, or a clear of a claimed floor: the candidate would take an unfinished building's stand away.
 */
export function standConflicts (site, cells = [], claims) {
  if (!claims) return null
  for (const c of cells ?? []) if (okAt(c?.at) && placedBox(c.role) === 'block' && claims.feet.has(kOf(c.at))) return { plot: claims.feet.get(kOf(c.at)), at: c.at, kind: 'feet' }
  for (const at of site?.fill ?? []) if (okAt(at) && claims.feet.has(kOf(at))) return { plot: claims.feet.get(kOf(at)), at, kind: 'feet' }
  for (const q of site?.clear ?? []) if (okAt(q?.at) && claims.floor.has(kOf(q.at))) return { plot: claims.floor.get(kOf(q.at)), at: q.at, kind: 'floor' }
  return null
}

/** The SOFT plots: their open work never enters another project's planned world (claim-01: they yield to a building). */
export const SOFT_PLOTS = Object.freeze(['tidy', 'land', 'siteprep'])
/**
 * THE PLANNED OBSTACLES of the other open HARD records -> { block: Set, noFloor: Set }. Pure. `done(rec, cell)` says whether a cell
 * already reads finished (the caller's read: a fill or cell laid, a clear (`role: 'clear'`) dug); a record not structure_complete and not `self`: its open solid cells are obstacles
 * (never floors), its open clears never floors. A light is no obstacle. Only takes stands away (B1).
 */
export function plannedWorld (records = [], { self = null, done = () => false, soft = SOFT_PLOTS } = {}) {
  const block = new Set(), noFloor = new Set()
  for (const r of records ?? []) {
    if (!r || r.structure_complete || r.plot === self || soft.includes(String(r.plot ?? ''))) continue
    const waived = r.waived ?? {}
    for (const c of r.cells ?? []) {
      if (!okAt(c?.at) || placedBox(c.role) !== 'block' || Object.prototype.hasOwnProperty.call(waived, kOf(c.at))) continue
      if (!done(r, c)) block.add(kOf(c.at))
    }
    // a laid fill is a real floor (never hidden: B2); a dug clear is air already
    for (const at of r.fill ?? []) if (okAt(at) && !done(r, { at, role: 'fill' })) block.add(kOf(at))
    for (const q of r.clear ?? []) if (okAt(q?.at) && !done(r, { at: q.at, role: 'clear' })) noFloor.add(kOf(q.at))
  }
  return { block, noFloor }
}
