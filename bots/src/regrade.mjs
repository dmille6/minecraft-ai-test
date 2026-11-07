// ROUGHGROUND-4 (owner 11-07 GO, ~13:10Z: "rough ground blends into gentle slopes like target 10 (meadow valley) / 11 (terraced
// mound)"): THE WIDE-AREA REGRADE. PURE: the target surface over a whole stage's ground and the cuts and fills toward it. Nothing here
// touches a bot or a file; roughground.mjs surveyRough runs it last, over the columns no earlier rule took, and the cells go on the same
// tidy record (the same visit code).
//
// WHY (the stacked simulation, docs/reports/roughground-design-2026-11-07.md): after pieces 1-3 the owner's circled areas still hold
// ~400 clump columns and ~680 ragged-edge columns -- raised and sunk areas WIDER than the per-column rules take (a clump is <= 9 columns).
//
// THE TARGET (minimal change, never a re-terrace of what is already gentle):
//   ROUGH set   a column with a 4-neighbour step of 2 or more, or 2 or more off the median of the ground round it (radius `win`)
//   START       every rough column at that median; every other open column is an ANCHOR at its own ground (a gentle slope, a terrace
//               step of 1, the bands' meadows stay as they are)
//   CLAMP       relaxed until every 4-neighbour pair of solved columns differs by 1 at most: each rough column clamped into
//               [max neighbour - 1, min neighbour + 1] (anchors and rough alike), the midpoint where they conflict; `iters` rounds
//   KEEP        a rough column the target would cut more than cutMax or fill more than fillMax is NATURAL RELIEF (a hill, a rise, a
//               dell): an anchor at its own ground, and the clamp runs again. Mountains, cliffs and the bigger hills never move.
// THE WORK: cut (top first) the town's own ground over the target (LEVEL: dirt, grass, stone, cobble, gravel -- never a log, an ore,
//   sand, a path), never where the cut's new ground would be open (a crust over the bots' tunnels) nor beside a hollow under a
//   neighbour's ground (no tunnel opened sideways); fill up to the target into open cells only (never liquid), the top `topsoil` (dirt:
//   it greens) and under it `core` (cobblestone). In TILES of `tile` x `tile` columns, nearest home first, until `cap` cells: the rest is
//   the next survey's (bounded chunks).

export const REGRADE = Object.freeze({ win: 3, iters: 60, cutMax: 3, fillMax: 3, tile: 8, cap: 600, roughStep: 2, roughDev: 2, minSamples: 12, cliff: 4 })
/** THE SWITCH: REGRADE=off|0|false|no -> no wide regrade; on by default. Pure. */
export const regradeOn = (env = process.env) => !/^(off|0|false|no)$/i.test(String(env?.REGRADE ?? '').trim())
export const LEVEL = /^(dirt|coarse_dirt|grass_block|podzol|rooted_dirt|cobblestone|mossy_cobblestone|cobbled_deepslate|stone|andesite|diorite|granite|tuff|gravel)$/
const SOIL = /^(dirt|grass_block|podzol|coarse_dirt|rooted_dirt|mycelium|moss_block)$/
// buildrun.mjs FOREIGN_CLEAR's ground (a record cell's foreign block the visit digs before it places)
const RESOIL = /^(cobblestone|stone|andesite|diorite|granite|cobbled_deepslate|deepslate|gravel)$/
const k2 = (x, z) => `${x},${z}`
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]]
const median = a => { const s = [...a].sort((p, q) => p - q); return s[Math.floor(s.length / 2)] }

/**
 * THE TARGET SURFACE -> { T: Map "x,z" -> y, rough: Set, kept: Set }. Pure.
 *   H      Map "x,z" -> ground y of every column that may be worked (anchors and candidates alike); a column absent is no constraint
 */
export function regradeTarget (H, { R = REGRADE, fixed = new Set() } = {}) {
  const at = k => H.get(k)
  const xz = k => k.split(',').map(Number)
  const rough = new Set(), cliffs = new Set()
  const med = new Map()
  for (const [k, y] of H) {
    const [x, z] = xz(k)
    let step = 0
    for (const [dx, dz] of N4) { const n = at(k2(x + dx, z + dz)); if (Number.isFinite(n)) step = Math.max(step, Math.abs(n - y)) }
    const ys = []
    for (let dx = -R.win; dx <= R.win; dx++) for (let dz = -R.win; dz <= R.win; dz++) { const n = at(k2(x + dx, z + dz)); if (Number.isFinite(n)) ys.push(n) }
    if (ys.length < R.minSamples) continue
    const m = median(ys)
    med.set(k, m)
    if (step >= R.roughStep || Math.abs(y - m) >= R.roughDev) rough.add(k)
    // A CLIFF (a 4-neighbour drop of `cliff` or more from this column): the edge of a hill or a rise -- natural relief, kept with
    // its foot (the clamp keeps the low side within reach of it, or KEEP takes it); the bots' pillars and pits are the rules' above
    if (step >= R.cliff) cliffs.add(k)
  }
  // both sides of a cliff pair are kept: the hill's edge AND its foot (no skirt of fill is raised against a hill)
  const kept = new Set(fixed)
  for (const k of cliffs) { const [x, z] = xz(k); for (const [dx, dz] of N4) { const nk = k2(x + dx, z + dz), n = at(nk); if (Number.isFinite(n) && Math.abs(at(k) - n) >= R.cliff) { kept.add(k); kept.add(nk) } } }   // a column a cut may not take (a hollow under it, a tunnel beside it): an anchor at its own ground
  let T
  for (let round = 0; round < 4; round++) {
    T = new Map()
    for (const [k, y] of H) T.set(k, rough.has(k) && !kept.has(k) ? med.get(k) : y)
    const solve = [...rough].filter(k => !kept.has(k)).sort()
    for (let it = 0; it < R.iters; it++) {
      let moved = 0
      for (const k of solve) {
        const [x, z] = xz(k)
        let lo = -Infinity, hi = Infinity
        for (const [dx, dz] of N4) { const n = T.get(k2(x + dx, z + dz)); if (Number.isFinite(n)) { lo = Math.max(lo, n - 1); hi = Math.min(hi, n + 1) } }
        const t0 = T.get(k)
        const t = lo <= hi ? Math.min(hi, Math.max(lo, t0)) : Math.round((lo + hi) / 2)
        if (t !== t0) { T.set(k, t); moved++ }
      }
      if (!moved) break
    }
    // NATURAL RELIEF: too deep a cut or fill keeps its column (an anchor at its own ground), and the clamp runs again
    let more = 0
    for (const k of solve) { const d = T.get(k) - at(k); if (d > R.fillMax || -d > R.cutMax) { kept.add(k); more++ } }
    if (!more) break
  }
  for (const k of kept) T.set(k, at(k))
  return { T, rough, kept }
}

/**
 * THE REGRADE'S WORK -> { cut: [{ at, name, tile }], fill: [{ at, role, tile }], tiles, census, skipped }. Pure over `read`.
 *   H          as regradeTarget;  open(x, y, z) a cell a block may go into;  solid(x, y, z) a full block (no hollow)
 *   home       nearest-first order;  R.cap  the cells this survey takes (the rest: the next survey's)
 */
export function regradeWork (read, H, { home, open, solid, wet = () => false, R = REGRADE } = {}) {
  const nmOf = b => String(b?.name ?? '').replace(/\[.*\]$/, '')
  const skipped = {}
  const skip = w => { skipped[w] = (skipped[w] ?? 0) + 1 }
  // THE CUTS THE GROUND REFUSES (a crust over the bots' tunnels, a tunnel beside, a block that is not the town's to cut) are not
  // skipped and left as steps: their columns become ANCHORS and the surface is fitted again, so the ground round them is FILLED up
  // to meet them instead (the honeycomb under the showcase: 183 of 246 refused cuts were a tunnel beside the cut)
  const fixed = new Set()
  const cutBad = (k, t) => {
    const [x, z] = k.split(',').map(Number); const y = H.get(k)
    for (let yy = y; yy > t; yy--) {
      const n = nmOf(read(x, yy, z))
      if (!LEVEL.test(n)) return 'regrade_natural'
      if (wet(x, yy, z)) return 'regrade_water'
      for (const [dx, dz] of N4) { const nt = H.get(k2(x + dx, z + dz)); if (open(x + dx, yy, z + dz) && (!Number.isFinite(nt) || nt > yy)) return 'regrade_side_hollow' }
    }
    if (!solid(x, t, z)) return 'regrade_hollow'
    return null
  }
  let fit
  for (let round = 0; round < 4; round++) {
    fit = regradeTarget(H, { R, fixed })
    let more = 0
    for (const k of fit.rough) { if (fit.kept.has(k)) continue; const t = fit.T.get(k); if (t < H.get(k)) { const w = cutBad(k, t); if (w) { fixed.add(k); skip(`${w}_anchored`); more++ } } }
    if (!more) break
  }
  const { T, rough, kept } = fit
  const byTile = new Map()
  for (const k of rough) {
    if (kept.has(k)) continue
    const [x, z] = k.split(',').map(Number)
    const y = H.get(k), t = T.get(k)
    if (t === y) continue
    const cut = [], fill = []
    let bad = null
    if (t < y) {
      // (cutBad above anchored every column whose cut the ground refuses: what is left is safe to cut)
      bad = cutBad(k, t)
      for (let yy = y; yy > t && !bad; yy--) cut.push({ at: [x, yy, z], name: nmOf(read(x, yy, z)) })
      // Codex (independent design): a cut never leaves bare stone on top -- the new top, when it is not soil, is laid again in dirt
      // (the visit's foreign dig takes it first: only what buildrun.mjs FOREIGN_CLEAR digs)
      if (!bad) { const n = nmOf(read(x, t, z)); if (!SOIL.test(n)) { if (RESOIL.test(n)) fill.push({ at: [x, t, z], role: 'topsoil' }); else bad = 'regrade_bare' } }
    } else {
      for (let yy = y + 1; yy <= t; yy++) { if (!open(x, yy, z) || wet(x, yy, z)) { bad = 'regrade_blocked'; break } fill.push({ at: [x, yy, z], role: yy === t ? 'topsoil' : 'core' }) }
    }
    if (bad) { skip(bad); continue }
    const tk = k2(Math.floor((x - home.x) / R.tile), Math.floor((z - home.z) / R.tile))
    if (!byTile.has(tk)) byTile.set(tk, { cut: [], fill: [], d: Infinity })
    const tl = byTile.get(tk)
    tl.cut.push(...cut); tl.fill.push(...fill)
    tl.d = Math.min(tl.d, Math.max(Math.abs(x - home.x), Math.abs(z - home.z)))
  }
  const out = { cut: [], fill: [], tiles: [], census: { rough: rough.size, kept: kept.size, columns: 0, cut: 0, fill: 0, tiles: 0 }, skipped }
  for (const [id, tl] of [...byTile].sort((a, b) => a[1].d - b[1].d || (a[0] < b[0] ? -1 : 1))) {
    const n = tl.cut.length + tl.fill.length
    if (out.cut.length + out.fill.length + n > R.cap && out.tiles.length) { skip('regrade_cap'); continue }
    out.tiles.push(id)
    for (const c of tl.cut) out.cut.push({ ...c, tile: id })
    for (const f of tl.fill) out.fill.push({ ...f, tile: id })
    out.census.columns += new Set([...tl.cut, ...tl.fill].map(q => k2(q.at[0], q.at[2]))).size
  }
  out.census.cut = out.cut.length; out.census.fill = out.fill.length; out.census.tiles = out.tiles.length
  return out
}
