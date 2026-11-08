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

const nm = b => String(b?.name ?? '').replace(/\[.*\]$/, '')
export const sitecanopyOn = (env = process.env) => !['off', '0', 'false', 'no'].includes(String(env?.SITECANOPY ?? '').trim().toLowerCase())
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
 * THE SITING HOOK -> (site) -> null | { clear } | { fail }. `cellsOf(site)` the candidate's world cells; `reached(clears)` -> { ok }
 * (the caller's reach test over the town walk, given every clear of the site plus the listed leaves, low before high). Nothing to list: null (the proof as before). Never throws (a throw: no listing).
 */
export function cellClearsHook (read, { cellsOf, reached, max = SITECANOPY_MAX } = {}) {
  return site => {
    try {
      const listed = new Set((site?.clear ?? []).map(c => (c?.at ?? []).join(',')))
      const cl = cellLeafClears(read, cellsOf(site), { listed, max })
      if (cl == null) return { fail: 'leaves_too_many' }
      if (!cl.length) return null
      // the reach test runs over EVERY clear the visit digs (the site's own trees and litter with these leaves, low before high, as
      // runVisit's clears() digs them): a site leaf dug first opens the sight line to a listed one behind it
      const all = [...(site?.clear ?? []), ...cl].sort((a, b) => a.at[1] - b.at[1] || a.at[0] - b.at[0] || a.at[2] - b.at[2])
      return reached(all)?.ok ? { clear: cl } : { fail: 'leaves_unreached' }
    } catch { return null }
  }
}
