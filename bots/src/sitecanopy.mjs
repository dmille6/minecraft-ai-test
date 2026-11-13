// SITECANOPY-01 (showcase, 11-08): A STYLED BUILDING'S SITE MAY LIST THE NATURAL LEAVES IN ITS OWN CELLS AS CLEARS.
//
// THE CASE (LIVE showcase ef40871b, 11-08): the cottage (townstyle-01, released 11-05 05:38Z) never sited: 80 of 80 visits in 7 d
// `site_wait`, every siting `no_proven_site [{"domain":33088,"door_not_toward_home":27}]` on plot X3. Offline replay of the siting on a
// region dump (buildsite.mjs screenSite + proveSite, the live code): of the 36 in-plot candidates 27 face away from home and the 9 that
// face home all fail the proof `cell_not_free` -- spruce_leaves in the pitched roof's cells (the eaves over the ring: the plot holds five
// spruces; the screen lists a tree's logs in the pad, never another tree's canopy over the roof) and, behind them, grass of the plot's
// slope. With the natural leaves IN THE BUILDING'S CELLS listed as clears (dug first by the building's own visit, low before high, each
// from a dig stand -- every one reached in order, reroof.mjs reroofClearsReached), cottage@1f sites at -3,-32 W (70 leaves listed;
// cottage@1s at -3,-33 W, 86) with the live siting run end to end on the dump (siteBlueprint + cottageSitingPlan; without the hook it
// answers exactly the live rejects and cell_not_free 9).
//
// THE RULE: siteBlueprint's caller names `ctx.cellClears(site)`; the cottage's and the town hall's siting list the natural leaves
// (persistent=false: grown, never placed -- a hedge is never dug) standing in the candidate's own cells; when any would never be reached
// the candidate fails its proof `leaves_unreached`. The listed leaves are the record's `clear` (the tripwire's G2: a dig on a listed
// clear of the record). SITECANOPY=off is the rollback (every siting as before).

import { leafFellSteps, leafBlockerText } from './leaffell.mjs'   // leaffell-01show: an unreached natural leaf asks for its trunk, not a stand

const nm = b => String(b?.name ?? '').replace(/\[.*\]$/, '')
export const sitecanopyOn = (env = process.env) => !['off', '0', 'false', 'no'].includes(String(env?.SITECANOPY ?? '').trim().toLowerCase())
export const sitePadOn = (env = process.env) => !['off', '0', 'false', 'no'].includes(String(env?.SITEPAD ?? '').trim().toLowerCase())   // thprep-01's rollback
export const SITECANOPY_MAX = 160   // leaves a site may list (the live cottage lists 96)

/** Natural leaves by a reader's block (`props.persistent` false; unread properties: never). Pure. */
export function naturalLeafAt (b) {
  if (!b || !/_leaves$/.test(nm(b))) return false
  const p = b.props
  return p?.persistent === false || p?.persistent === 'false'
}

/**
 * THE LEAVES IN A CANDIDATE'S CELLS -> [{ at, kind: 'leaves', name }] low before high | null (more than `max`: no such site). Pure.
 * `cells` the candidate's world cells ([x, y, z]); never a cell the site already clears (`listed`: its trees, its litter).
 */
export function cellLeafClears (read, cells = [], { listed = new Set(), max = SITECANOPY_MAX } = {}) {
  const out = [], seen = new Set()
  for (const at of cells) {
    if (!Array.isArray(at)) continue
    const k = at.join(',')
    if (seen.has(k) || listed.has(k)) continue
    seen.add(k)
    const b = read(...at)
    if (naturalLeafAt(b)) out.push({ at: at.slice(), kind: 'leaves', name: nm(b) })
  }
  if (out.length > max) return null
  return out.sort((a, b) => a.at[1] - b.at[1] || a.at[0] - b.at[0] || a.at[2] - b.at[2])
}

/**
 * thprep-01: THE BUILDING'S VOLUME -> [[x, y, z]]: every position in the bounding box of its cells (x, z and y). Pure. Natural leaves in
 * the INTERIOR are no cell (a room is air), yet they stand in the building and hide its upper cells from the laid floor (LIVE X2: 4 of
 * the town hall's in-cell leaves at y 69-70 stay unseen behind interior leaves at 66-68); a room full of leaves is never a building.
 */
export function volumeOf (cells = []) {
  const at = cells.map(c => (Array.isArray(c) ? c : c?.at)).filter(Array.isArray)
  if (!at.length) return []
  const lo = [0, 1, 2].map(i => Math.min(...at.map(a => a[i]))), hi = [0, 1, 2].map(i => Math.max(...at.map(a => a[i])))
  const out = []
  for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) out.push([x, y, z])
  return out
}
/** thprep-01: NATURAL TERRAIN a building's volume may cut (never cobblestone, planks or anything placed-looking). */
export const SITE_EARTH = /^(dirt|grass_block|coarse_dirt|podzol|rooted_dirt|mycelium|stone|andesite|diorite|granite|tuff|gravel|sand|red_sand|clay|moss_block|snow_block)$/
/**
 * thprep-01: THE TERRAIN IN A BUILDING'S VOLUME ABOVE ITS FLOOR -> [{ at, kind: 'cut', name }] high before low within a column, low
 * columns first overall (runVisit digs clears low before high: the whole list is sorted by the caller). Pure. `above` the floor's y (the
 * pad): only positions at y >= above + 1 (the pad cell itself is the building's); never a listed cell; a stray sapling there only when
 * `owned(at)` says no record owes it.
 */
export function cellEarthClears (read, vol = [], { above, listed = new Set(), owned = null } = {}) {
  const out = []
  for (const at of vol) {
    if (!Array.isArray(at) || !(at[1] > above) || listed.has(at.join(','))) continue
    const b = read(...at)
    if (b && SITE_EARTH.test(nm(b))) {
      // Codex r1 BLOCKER: never another record's cell (`owned`), and never the ground under a sapling this list does not take (an owed
      // replant, or one with no `owned` test): digging its support would uproot it
      if (typeof owned === 'function' && owned(at)) continue
      const up = read(at[0], at[1] + 1, at[2])
      if (up && /_sapling$|^mangrove_propagule$/.test(nm(up)) && !(typeof owned === 'function' && !owned([at[0], at[1] + 1, at[2]]))) continue
      out.push({ at: at.slice(), kind: 'cut', name: nm(b) })
    }
    // a STRAY sapling on that slope (LIVE X2 -12,69,-61: no record lists it as a replant or a cell) goes with its ground; one a record
    // owes (`owned(at)`: a replant cell, any record's cell) never -- and with no `owned` test, never
    else if (b && /_sapling$|^mangrove_propagule$/.test(nm(b)) && typeof owned === 'function' && !owned(at)) out.push({ at: at.slice(), kind: 'plant', name: nm(b) })
  }
  return out.sort((a, b) => a.at[1] - b.at[1] || a.at[0] - b.at[0] || a.at[2] - b.at[2])
}
/**
 * THE SITING HOOK -> (site) -> null | { clear } | { fail }. `cellsOf(site)` the candidate's world cells; `reached(clears)` -> { ok }
 * (the caller's reach test over the town walk, given every clear of the site plus the listed leaves, low before high). Nothing to list: null (the proof as before). Never throws (a throw: no listing).
 */
export function cellClearsHook (read, { cellsOf, reached, reachedSteps = null, max = SITECANOPY_MAX, earth = null, leafFell = null } = {}) {
  // siteproof-02: the hook's own steps (`hook.steps(site)`, a generator the cooperative search runs with `yield *`): the reach test
  // is the caller's `reachedSteps(clears, site)` when it names one (clearsReachedBuiltSteps: a turn after every walk), else `reached`
  // straight through as before. `hook(site)` runs the steps to their end: the same answer either way.
  function * steps (site, lfx = hook.leafFell) {
    try {
      const listed = new Set((site?.clear ?? []).map(c => (c?.at ?? []).join(',')))
      const vol = cellsOf(site)
      const lv = cellLeafClears(read, vol, { listed, max })
      if (lv == null) return { fail: 'leaves_too_many' }
      // thprep-01 (`earth` = { cut }: the building's own earthwork limit): the terrain left in its volume ABOVE its floor (a slope the
      // screen's level cut never reaches: LIVE X2, dirt at y 70 over a floor at 64) is listed too, while the site's cut stays in budget
      let ea = []
      if (earth && Number.isFinite(site?.s)) {
        ea = cellEarthClears(read, vol, { above: site.s, listed, owned: earth.owned })
        if ((site.cut?.length ?? 0) + ea.length > (Number(earth.cut) || 0)) return { fail: 'earth_over' }
      }
      const cl = [...lv, ...ea]
      if (!cl.length) return null
      // the reach test runs over EVERY clear the visit digs (the site's own trees and litter with these leaves, low before high, as
      // runVisit's clears() digs them): a site leaf dug first opens the sight line to a listed one behind it
      const all = [...(site?.clear ?? []), ...cl].sort((a, b) => a.at[1] - b.at[1] || a.at[0] - b.at[0] || a.at[2] - b.at[2])
      const rc = typeof reachedSteps === 'function' ? yield * reachedSteps(all, site) : reached(all, site)
      // leaffell-01show (`leafFell` = { plan(site, vol) -> leafFellPlan's options, onDecision?(site, answer) }; null: as before): the digs
      // the reach test found no stand for are asked what HOLDS them -- a natural leaf whose trunk comes down is no blocker (marked
      // `decay`), a tree nobody owns that holds one is listed whole (`trees`: its saplings owed, the search's replantFor) and the
      // reach test runs again over the longer list (its own steps: a turn after every walk). Anything else: the old answer, the
      // leaf and the reason named (`detail`).
      if (!rc?.ok && lfx && Array.isArray(rc?.unreached)) {
        const again = typeof reachedSteps === 'function' ? list => reachedSteps(list, site) : function * (list) { return reached(list, site) }
        const lf = yield * leafFellSteps(read, all, rc, again, lfx.plan?.(site, vol) ?? {})
        try { lfx.onDecision?.(site, lf) } catch { /* telemetry */ }
        if (!lf.ok) return { fail: 'leaves_unreached', detail: leafBlockerText(lf.blockers?.[0]) }
        // the hook's own leaves (marked where they only wait for a trunk) and the logs the plan adds; the site's own entries are marked by the search (`decay`)
        const mine = new Set([...cl, ...lf.fell].map(c => c.at.join(',')))
        return { clear: lf.clear.filter(c => mine.has(c.at.join(','))), decay: lf.decay,
          ...(lf.trees.length ? { trees: lf.trees } : {}), ...(lf.fell.length ? { fellLogs: lf.fell.map(c => c.at) } : {}), leaf: { decay: lf.decay.length, fell: lf.fell.length, trees: lf.trees.length } }
      }
      return rc?.ok ? { clear: cl } : { fail: 'leaves_unreached' }
    } catch { return null }
  }
  const hook = site => { const g = steps(site); for (;;) { const r = g.next(); if (r.done) return r.value } }
  hook.steps = steps
  hook.leafFell = leafFell   // leaffell-01show: the search may name it after the hook is made (buildsite.mjs siteBlueprintSteps `ctx.leafFell`)
  return hook
}

/**
 * thprep-01 (11-08): ARE THE CLEARS DUG AS THE VISIT DIGS THEM? -> { ok, unreached: [[x, y, z]], rounds, padLaid }. Pure but for the
 * injected `walk(read) -> Set('x,y,z' feet)` and `stand(read, cell, nodes)` (buildsite walkFrom / buildrun digStand, by the caller).
 * runVisit digs the record's clears before its segments and AGAIN after each segment it completes ("a log no ground stand reaches
 * comes down once the pad gives it an eye"): so the clears are dug from the town walk (low before high), then the building's FLOOR
 * (its `padSeg` cells, and the site's earth fills) is laid where it is free, and the rest are dug from the walk over the laid floor --
 * repeated while anything moves (at most `rounds`). LIVE showcase 11-08, the town hall's one home-facing candidate on X2 (-5,-46 W):
 * 10 of its 26 in-cell leaves (y 69-70, over the pad's middle) no stand of the town walk reaches; the floor is laid at 64.
 */
export function clearsReachedBuilt (read, clears = [], opts = {}) {
  const g = clearsReachedBuiltSteps(read, clears, opts)
  for (;;) { const r = g.next(); if (r.done) return r.value }
}
/**
 * SITEPROOF-02 (LIVE showcase 11-12 22:05Z, one hour after siteproof-01: Delta kicked `Timed out` once a minute; its stack at 100%
 * CPU: walkFrom <- walk <- clearsReachedBuilt <- reached <- the siting hook <- siteBlueprintSteps). THE SAME TEST AS A GENERATOR,
 * yielding after every walk of the town. The test walks once for the first clear and AGAIN after every clear it digs (a dug leaf
 * may open the next one's stand): a candidate with 26 leaves in its cells is 26 walks and more, 1.0 to 6.0 s each on that host,
 * straight through inside ONE step of the cooperative search -- minutes with the event loop held, the server's 30-s keep-alive
 * missed, the bot dropped; and a dropped bot's search never ends `no_site`, so its next build order runs the same search again.
 * The result is clearsReachedBuilt's, value for value.
 */
export function * clearsReachedBuiltSteps (read, clears = [], { cells = [], fill = [], padSeg = 'pad', walk, stand, rounds = 4 } = {}) {
  const k = a => a.join(',')
  const AIR = Object.freeze({ name: 'air', boundingBox: 'empty' }), S = Object.freeze({ name: 'cobblestone', boundingBox: 'block' })
  const pad = [...cells.filter(c => c?.seg === padSeg && Array.isArray(c.at)).map(c => c.at), ...fill.filter(Array.isArray)]
  const dug = new Map(), laid = new Set()
  const rd = (x, y, z) => { const q = `${x},${y},${z}`; return dug.get(q) ?? (laid.has(q) ? S : read(x, y, z)) }
  const free = b => !b || b.boundingBox === 'empty' || /^(air|cave_air|short_grass|tall_grass|fern|large_fern|snow)$/.test(nm(b))
  let left = [...clears].sort((a, b) => a.at[1] - b.at[1] || a.at[0] - b.at[0] || a.at[2] - b.at[2])
  let r = 0
  for (; r < rounds && left.length; r++) {
    let moved = false, nodes = null
    const still = []
    for (const c of left) {
      // homes-02show: the walk is told the cells this read differs in (buildsite.mjs makeWalkCache answers it from one kept walk)
      if (!nodes) { const m = new Map(); for (const q of walk(rd, [dug.keys(), laid])) { const [x, y, z] = q.split(',').map(Number); const col = `${x},${z}`; if (!m.has(col)) m.set(col, []); m.get(col).push(y) } nodes = m; yield null }
      if (!stand(rd, c.at, nodes)) { still.push(c); continue }
      dug.set(k(c.at), AIR); nodes = null; moved = true
    }
    for (const a of pad) if (!laid.has(k(a)) && free(rd(...a))) { laid.add(k(a)); moved = true }
    left = still
    if (!moved) break
  }
  return { ok: !left.length, unreached: left.map(c => c.at.slice()), rounds: r, padLaid: laid.size }
}
