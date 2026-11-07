// ROUGHGROUND-3 (owner 11-07, the target pictures: "a round island mound of neat concentric grass terraces with ONE big tree on top"):
// THE TOWN'S LANDMARK -- a round terraced mound, 1-block steps, grass tops, one tree on its crown, sited ONCE by the terrace stage on
// open, flat, graded ground inside the wall (beside the park, never on it), published on the land record (`land.landmark`: a
// reservation other builds keep off, and the terrace's grading never flattens it again). PURE: the site and the cells. Nothing here
// touches a bot or a file. LANDMARK=off is the rollback (no mound sited; one already standing is kept as it is).
//
// THE SHAPE: round rings by Euclidean distance d from the centre column -- d <= 1.5 the crown (+3), d <= 2.5 (+2), d <= 3.5 (+1), the
// rest of the 9x9 the lawn round it (left as it is). 9 + 12 + 16 columns, 27 + 24 + 16 = 67 fills from flat ground: the buried ones the
// town's cobblestone (tidy.mjs coreFills), the tops dirt (the grass round greens it: Paper 11-07, beside grass within minutes). The tree:
// one sapling on the crown's centre with REPLANT_AIR open above it (the park's sapling roles: whatever sapling the town holds).

export const LANDMARK = Object.freeze({ r: 4, rings: [[1.5, 3], [2.5, 2], [3.5, 1]], spread: 3, air: 6, cands: 3, cutMax: 3 })
/** What the mound's shaping may cut (the town's own ground and the bots' rubble; never a log, an ore, sand, a path, a build). */
export const LEVEL = /^(dirt|coarse_dirt|grass_block|podzol|rooted_dirt|cobblestone|mossy_cobblestone|cobbled_deepslate|stone|andesite|diorite|granite|tuff|gravel)$/
/** THE SWITCH: LANDMARK=off|0|false|no -> no mound sited; on by default. Pure. */
export const landmarkOn = (env = process.env) => !/^(off|0|false|no)$/i.test(String(env?.LANDMARK ?? '').trim())
const k2 = (x, z) => `${x},${z}`
/** A column's rise on the mound -> 0..3. Pure. */
export function moundRise (dx, dz, L = LANDMARK) {
  const d = Math.sqrt(dx * dx + dz * dz)
  for (const [r, h] of L.rings) if (d <= r) return h
  return 0
}
/** The landmark's box [x0, z0, x1, z1] round a centre. Pure. */
export const landmarkBox = (c, L = LANDMARK) => [c[0] - L.r, c[1] - L.r, c[0] + L.r, c[1] + L.r]

/**
 * THE SITE -> { centre: [x, z], base, box } | null. Pure. A (2r+1)^2 square of graded open columns (H: the ground as the grading leaves
 * it; every column present, none `taken` -- the park + 1, a road or path + 1, a record cell, a kept column), its ground within
 * L.spread of its median, and the crown's column open L.air above (`airAt(x, y, z)`). The flattest nearest `home` first; the seed
 * picks one of the best L.cands distinct sites.
 */
export function landmarkSite (H, box, opts = {}) {
  const all = landmarkSites(H, box, opts)
  return all.length ? all[((opts.seed ?? 0) >>> 0) % Math.min(all.length, (opts.L ?? LANDMARK).cands)] : null
}
/** Every distinct site, the least work first (landmarkSite's order) -> [site]. Pure. */
export function landmarkSites (H, box, { home, taken = () => false, airAt = () => true, L = LANDMARK } = {}) {
  const cands = []
  for (let cx = box[0] + L.r + 1; cx <= box[2] - L.r - 1; cx++) for (let cz = box[1] + L.r + 1; cz <= box[3] - L.r - 1; cz++) {
    const ys = []
    let ok = true
    for (let x = cx - L.r; x <= cx + L.r && ok; x++) for (let z = cz - L.r; z <= cz + L.r; z++) {
      const y = H.get(k2(x, z))
      if (!Number.isFinite(y) || taken(x, z)) { ok = false; break }
      ys.push(y)
    }
    if (!ok) continue
    const sorted = [...ys].sort((a, b) => a - b)
    if (sorted[sorted.length - 1] - sorted[0] > L.spread) continue
    const base = sorted[Math.floor(sorted.length / 2)]
    let open = true
    for (let y = base + 1; y <= base + 3 + L.air && open; y++) if (!airAt(cx, y, cz)) open = false
    if (!open) continue
    // ROUGH GROUND IS SHAPED (the town has no flat 9x9 left inside the wall: measured 11-07): every ring column is cut or filled to
    // base + its rise; the work is the score (the least first), then the distance from home. A cut deeper than cutMax: no site.
    let work = 0, deep = false
    for (let x = cx - L.r; x <= cx + L.r && !deep; x++) for (let z = cz - L.r; z <= cz + L.r; z++) {
      const h = moundRise(x - cx, z - cz, L)
      if (!h) continue
      const d = H.get(k2(x, z)) - (base + h)
      if (d > L.cutMax) { deep = true; break }
      work += Math.abs(d)
    }
    if (deep) continue
    cands.push({ centre: [cx, cz], base, box: landmarkBox([cx, cz], L), score: work * 10 + Math.max(Math.abs(cx - home.x), Math.abs(cz - home.z)) })
  }
  cands.sort((a, b) => a.score - b.score || a.centre[0] - b.centre[0] || a.centre[1] - b.centre[1])
  const best = []
  for (const c of cands) {
    if (best.some(p => Math.max(Math.abs(p.centre[0] - c.centre[0]), Math.abs(p.centre[1] - c.centre[1])) <= 2 * L.r)) continue
    best.push(c)
  }
  return best
}

/**
 * THE MOUND'S CELLS -> { fill: [{ at }], sapling: [x, y, z] }. Pure over `top(x, z)` (the column's ground now) and `open(x, y, z)` (a
 * cell a block may go into). Every column of the rings filled from its ground up to base + rise (a cell already solid is not listed:
 * a mound partly standing is repaired, never rebuilt); the sapling on the crown, one over its top.
 */
export function landmarkCells (site, { top, open = () => true, read = null, L = LANDMARK } = {}) {
  const [cx, cz] = site.centre
  const fill = [], cut = []
  const nmOf = b => String(b?.name ?? '').replace(/\[.*\]$/, '')
  for (let x = cx - L.r; x <= cx + L.r; x++) for (let z = cz - L.r; z <= cz + L.r; z++) {
    const h = moundRise(x - cx, z - cz, L)
    if (!h) continue
    const t = top(x, z)
    if (!Number.isFinite(t)) continue
    const want = site.base + h
    for (let y = t + 1; y <= want; y++) if (open(x, y, z)) fill.push({ at: [x, y, z] })
    // over the mound's shape: cut, top first, only the town's own ground; the ground under the cut must be solid (no hollow opened)
    if (t > want) {
      if (!read) return null
      for (let y = t; y > want; y--) { const n = nmOf(read(x, y, z)); if (!LEVEL.test(n)) return null; cut.push({ at: [x, y, z], name: n }) }
      if (open(x, want, z)) return null
    }
  }
  return { fill, cut, sapling: [cx, site.base + 4, cz] }
}
/** THE LANDMARK AS A RESERVATION ZONE (landplan.mjs landReservation) -> [{ box, why }]. Pure. */
export function landmarkZones (land) {
  const b = land?.landmark?.box
  return Array.isArray(b) && b.length === 4 && b.every(Number.isFinite) ? [{ box: [b[0], -64, b[1], b[2], 320, b[3]], why: 'land:landmark' }] : []
}

/**
 * THE KEEPER'S LANDMARK ADDITION -> { cells, segments, landmark } | null (none now: no sapling held, no site, nothing to lay). Pure over
 * `read`. Sited once (the land record keeps it: the caller publishes `landmark`); the town must hold a sapling (the crown's tree: the
 * owner's "one big tree on top"). The fills layered T-LM0..2 (each layer on the one below), the column tops `earth` (dirt: it greens),
 * the cells under them `core` (the town's cobblestone), the sapling (`sapling0`, the park's sapling role) on the crown after the top.
 *   box       where it may go (the wall's interior);  col(x, z) the column's ground y | null (unread, water, built);  taken(x, z)
 *   home, seed; have  { item: n } the town's stock + the keeper's bag + the crew's pantry
 */
export function landmarkPlan (read, { box, home, seed = 0, have = {}, col, taken = () => false, saplings = [], L = LANDMARK } = {}) {
  if (!Array.isArray(box) || !home || typeof col !== 'function') return null
  if (!(saplings ?? []).some(n => (Number(have?.[n]) || 0) > 0)) return null
  const nmOf = b => String(b?.name ?? '').replace(/\[.*\]$/, '')
  const air = (x, y, z) => { const b = read(x, y, z); return !!b && (/^(air|cave_air)$/.test(nmOf(b)) || b.boundingBox === 'empty') && !/water|lava/.test(nmOf(b)) }
  const H = new Map()
  for (let x = box[0]; x <= box[2]; x++) for (let z = box[1]; z <= box[3]; z++) { if (taken(x, z)) continue; const y = col(x, z); if (Number.isFinite(y)) H.set(k2(x, z), y) }
  // the sites, the least work first, the seed rotating among the best L.cands; a site whose shaping meets a block it may not cut (or
  // would open a hollow) is passed for the next
  const sites = landmarkSites(H, box, { home, taken, airAt: air, L })
  const rot = sites.length ? (seed >>> 0) % Math.min(sites.length, L.cands) : 0
  let site = null, shaped = null
  for (let i = 0; i < sites.length; i++) {
    const s0 = sites[(i + rot) % sites.length]
    const sh = landmarkCells(s0, { top: (x, z) => H.get(k2(x, z)), open: air, read, L })
    if (sh && (sh.fill.length || sh.cut.length)) { site = s0; shaped = sh; break }
  }
  if (!site) return null
  const { fill, cut, sapling } = shaped
  const minY = Math.min(...fill.map(f => f.at[1]), site.base + 1)
  const topOf = new Map()
  for (const f of fill) { const k = k2(f.at[0], f.at[2]); topOf.set(k, Math.max(topOf.get(k) ?? -Infinity, f.at[1])) }
  const cells = fill.map(f => ({ at: f.at, role: f.at[1] === topOf.get(k2(f.at[0], f.at[2])) ? 'earth' : 'core', seg: `T-LM${f.at[1] - minY}`, landmark: true }))
  const layers = [...new Set(cells.map(c => c.seg))].sort((a, b) => Number(a.slice(4)) - Number(b.slice(4)))
  const segments = layers.map((seg, i) => ({ seg, deps: i ? [layers[i - 1]] : [] }))
  cells.push({ at: sapling, role: 'sapling0', seg: 'T-LMS', el: 'trees', landmark: true })
  segments.push({ seg: 'T-LMS', deps: layers.length ? [layers[layers.length - 1]] : [] })
  return { cells, segments, cut: cut.map(c => ({ at: c.at, kind: 'tidy', name: c.name, landmark: true })), landmark: { centre: site.centre, base: site.base, box: site.box, tree: sapling, seed } }
}
