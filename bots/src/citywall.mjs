// CITYWALL-01: THE TOWN WALL UPGRADE (OWNER 2026-11-09: "re-face or rebuild the cobble walls in stone bricks: a crenellated top, corner
// towers, a gatehouse at the main road, and lights. Retrofit in place, never leaving a gap"). Design: docs/reports/citywall-design-2026-11-09.md
// (Codex + an independent Claude proposal, reconciled; measured on the showcase 11-09). PURE: the style, the design cells, the phases,
// the bills and the next phase. Nothing here touches a bot or a file.
//
// WHAT IT IS: a NEW GENERATION of a standing wall record (wall@1 / wallext@1). The rampart keeps its cross-section (wall.mjs: O the wall,
// S2 the walk, S1 the fire-step) and every opening (gateways, sally ports, natural gaps); the O column's cobblestone is SWAPPED IN PLACE,
// cell by cell, for a coursed masonry face, and new cells are added:
//   COURSES (by height over the column's base b):  <= b foot | b+1 plinth | b+2 body | b+3 band | b+4 merlon (the existing rhythm:
//            every other column and both run ends -- the one-way escape over a crenel that wallEscape proves is kept as it is)
//   UNDERPINNING  a column whose lowest cell hangs over air (measured 11-09: 86 of the showcase's 215 wall columns over a void two or
//            more high) gets foot cells down to its ground, at most CITYWALL.underMax
//   TOWERS   3 x 3 bastions projecting OUTWARD from the line (in-line row + 2 rows out), at a ring corner that is wall and at the run end
//            nearest a gapped corner; courses to tb+5, merlons on the corners and the outer middle at tb+6, a lantern on the outer
//            merlon, an iron-bar slit; the hidden centre column is cobblestone (the town's junk)
//   GATEHOUSE  over one gateway: a flanking tower each side and a DECK 3 deep at g+4 over the passage (headroom g+1..g+3 kept),
//            merlons on its outer edge, a parapet on its inner edge, a keystone, haunch stairs at the passage's edges, lanterns hung
//            under its outer row
//   LAMPS    a lantern (else a torch) on the merlon at each run's two ends, so every opening is flanked by a pair of lights
// THE SWAP (never a gap): every replaced cell carries `sw: 1`; the visit (buildrun.mjs runVisit `p.swap`) digs a sw cell only while its
// segment has NO open hole and the bag holds the cell's block, lowest first, and places it before the next dig -- at most one 1 x 1
// hole per segment, never two high (a bot needs two), never a passage.
// THE PHASES: the design is cut into UNITS (the gatehouse with the runs either side, each tower with its run, then the other runs
// nearest the towers first); one generation adds one phase, only when the previous phases stand and the town holds the phase's bill
// (citywallNext). A partial upgrade is always whole towers and whole runs, never a half-dressed course.
// CITYWALL=off is the rollback (no new generation; a published one is an ordinary record: its open cells are repaired or waived).

export const CITYWALL_PLOT = 'citywall'
export const CITYWALL = Object.freeze({ underMax: 6, towerOut: 2, towerRise: 5, towersMax: 6, cornerReach: 6, gateHead: 3, gateMaxP: 20, lampIceR: 3, mossBody: 0.16, mossMerlon: 0.1 })
/** The roles a citywall generation adds (every one prefixed: no other module's `role === 'wall'` reads them as the old wall). */
export const CW = Object.freeze({ foot: 'cw-foot', plinth: 'cw-plinth', body: 'cw-body', bodym: 'cw-bodym', band: 'cw-band', merlon: 'cw-merlon', merlonm: 'cw-merlonm', tower: 'cw-tower', quoin: 'cw-quoin', tcore: 'cw-tcore', tmerlon: 'cw-tmerlon', slit: 'cw-slit', deck: 'cw-deck', dedge: 'cw-dedge', parapet: 'cw-parapet', key: 'cw-key', haunch: 'cw-haunch', lamp: 'cw-lamp', hang: 'cw-hang' })
/** THE STYLES: role -> block names, first wanted (the bill draws it), the rest accepted (cellDone by family) and placed when the bag
 *  holds no earlier one. grey: a stone-brick face on a dark deepslate plinth and band (the showcase); dark: deepslate bricks with a
 *  stone band (the fleet: cobbled deepslate makes deepslate bricks with no fuel). */
export const WALL_STYLES = Object.freeze({
  grey: Object.freeze({
    [CW.foot]: ['deepslate_bricks', 'stone_bricks'], [CW.plinth]: ['deepslate_bricks', 'stone_bricks'], [CW.body]: ['stone_bricks'], [CW.bodym]: ['mossy_stone_bricks', 'stone_bricks'],
    [CW.band]: ['deepslate_bricks', 'stone_bricks'], [CW.merlon]: ['stone_bricks'], [CW.merlonm]: ['mossy_stone_bricks', 'stone_bricks'],
    [CW.tower]: ['stone_bricks'], [CW.quoin]: ['deepslate_bricks', 'stone_bricks'], [CW.tcore]: ['cobblestone', 'mossy_cobblestone', 'stone_bricks'], [CW.tmerlon]: ['stone_bricks'],
    [CW.slit]: ['iron_bars', 'stone_bricks'], [CW.deck]: ['stone_bricks'], [CW.dedge]: ['deepslate_bricks', 'stone_bricks'], [CW.parapet]: ['stone_brick_wall', 'cobblestone_wall'],
    [CW.key]: ['chiseled_stone_bricks', 'stone_bricks'], [CW.haunch]: ['stone_brick_stairs'], [CW.lamp]: ['lantern', 'torch'], [CW.hang]: ['lantern'],
  }),
  dark: Object.freeze({
    [CW.foot]: ['deepslate_bricks', 'stone_bricks'], [CW.plinth]: ['deepslate_bricks', 'stone_bricks'], [CW.body]: ['deepslate_bricks'], [CW.bodym]: ['deepslate_bricks'],
    [CW.band]: ['stone_bricks', 'deepslate_bricks'], [CW.merlon]: ['deepslate_bricks'], [CW.merlonm]: ['deepslate_bricks'],
    [CW.tower]: ['deepslate_bricks'], [CW.quoin]: ['stone_bricks', 'deepslate_bricks'], [CW.tcore]: ['cobblestone', 'cobbled_deepslate', 'deepslate_bricks'], [CW.tmerlon]: ['deepslate_bricks'],
    [CW.slit]: ['iron_bars', 'deepslate_bricks'], [CW.deck]: ['deepslate_bricks'], [CW.dedge]: ['stone_bricks', 'deepslate_bricks'], [CW.parapet]: ['deepslate_brick_wall', 'cobblestone_wall'],
    [CW.key]: ['chiseled_deepslate', 'deepslate_bricks'], [CW.haunch]: ['deepslate_brick_stairs'], [CW.lamp]: ['lantern', 'torch'], [CW.hang]: ['lantern'],
  }),
})
/** The old wall's palette (wall.mjs WALL_PALETTE): copied so this module stays a leaf; a test asserts the copy. */
export const OLD_WALL_PALETTE = Object.freeze({ wall: ['cobblestone', 'mossy_cobblestone'], step: ['cobblestone', 'mossy_cobblestone'], base: ['cobblestone', 'mossy_cobblestone'], post: ['stone_bricks', 'cobblestone'], light: ['torch'] })
/** A generation's whole palette: the old roles (steps, posts and lights the upgrade leaves) and the style's. Pure. */
export const citywallPalette = style => ({ ...OLD_WALL_PALETTE, ...Object.fromEntries(Object.entries(WALL_STYLES[style] ?? WALL_STYLES.grey).map(([k, v]) => [k, [...v]])) })

const onOff = v => { const s = String(v ?? '').trim().toLowerCase(); return ['on', '1', 'true', 'yes'].includes(s) ? true : ['off', '0', 'false', 'no'].includes(s) ? false : null }
/** THE SWITCH -> bool. CITYWALL=on|off; unset = on in CITYWALL_POOLS (default 'showcase'). Pure. */
export function citywallOn (env = process.env, pool = '') {
  const v = onOff(env?.CITYWALL)
  if (v != null) return v
  const pools = String(env?.CITYWALL_POOLS ?? 'showcase').split(',').map(s => s.trim()).filter(Boolean)
  return pools.includes('*') || pools.includes(String(pool))
}

const k2 = (x, z) => `${x},${z}`
const k3 = (x, y, z) => `${x},${y},${z}`
const kOf = a => k3(a[0], a[1], a[2])
const nm = b => String(b?.name ?? '').replace(/\[.*\]$/, '')
/** A 32-bit hash of a seed and a cell (the moss and every seeded choice). Pure. */
export function hash32 (seed, ...xs) {
  let h = (Number(seed) >>> 0) ^ 0x9e3779b9
  for (const x of xs) { h = Math.imul(h ^ (Number(x) | 0), 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16 }
  return h >>> 0
}
const unit = (seed, ...xs) => hash32(seed, ...xs) / 4294967296

/** Ground a wall stands on: a full block that is not a plant, a tree, a liquid. Pure. */
export const groundOk = b => !!b && b.boundingBox === 'block' && !/_leaves$|_log$|_wood$|^(water|lava|ice|packed_ice|blue_ice|frosted_ice)$/.test(nm(b))
/** A cell open to a placement (air, a plant, snow layer, a torch). Pure. */
export const airish = b => !!b && b.boundingBox === 'empty' && !/^(water|lava|bubble_column)$/.test(nm(b))

// ---- the record's columns ---------------------------------------------------------------------------------------------------------

/** The outward normals of a ring column -> [[dx, dz]] (a corner has two). Pure. */
export function outNormals (ring, x, z) {
  const [x0, z0, x1, z1] = ring
  const o = []
  if (z === z0) o.push([0, -1])
  if (x === x1) o.push([1, 0])
  if (z === z1) o.push([0, 1])
  if (x === x0) o.push([-1, 0])
  return o
}
/**
 * THE WALL COLUMNS of a record -> [{ x, z, i, b, n: [[dx, dz]], cells: [cell] (O cells, lowest first), seg, run }] in loop order.
 * Pure. An O column is a `cols` entry `wall` or `post` with a base b; its cells are the record's wall/post/base cells there (retired
 * cells are not the record's any more). `run` numbers maximal runs of consecutive columns (the loop order; a corner joins its sides).
 */
export function wallColumns (rec) {
  const ret = new Set((rec?.retired ?? []).map(c => kOf(c.at)))
  const byCol = new Map()
  for (const c of rec?.cells ?? []) {
    if (!['wall', 'post', 'base'].includes(c.role) || ret.has(kOf(c.at))) continue
    const k = k2(c.at[0], c.at[2])
    if (!byCol.has(k)) byCol.set(k, [])
    byCol.get(k).push(c)
  }
  const out = []
  let run = -1, prevI = -2
  ;(rec?.cols ?? []).forEach((c, i) => {
    if (!(c.s === 'wall' || c.s === 'post') || !Number.isFinite(c.b)) return
    const cells = (byCol.get(k2(c.x, c.z)) ?? []).slice().sort((a, b) => a.at[1] - b.at[1])
    if (!cells.length) return
    if (i !== prevI + 1) run++
    prevI = i
    out.push({ x: c.x, z: c.z, i, b: c.b, n: outNormals(rec.ring, c.x, c.z), cells, seg: cells[0].seg, run })
  })
  // the loop closes: a run that ends at the loop's last column and one that starts at its first are one run
  const L = (rec?.cols ?? []).length
  if (out.length > 1 && out[0].i === 0 && out.at(-1).i === L - 1 && out[0].run !== out.at(-1).run) { const r0 = out.at(-1).run; for (const c of out) if (c.run === r0) c.run = out[0].run }
  return out
}
/** Runs -> [[column]] in loop order (a closed-loop run starts at its first column after a break). Pure. */
export function wallRuns (cols) {
  const m = new Map()
  for (const c of cols) { if (!m.has(c.run)) m.set(c.run, []); m.get(c.run).push(c) }
  for (const r of m.values()) {
    // a run wrapped over the loop's end: its columns from the break on
    for (let j = 1; j < r.length; j++) if (r[j].i !== r[j - 1].i + 1) { r.push(...r.splice(0, j)); break }
  }
  return [...m.values()]
}

// ---- the courses -------------------------------------------------------------------------------------------------------------------

/** An O cell's course role by its height over the column's base and the seed (the moss). Pure. */
export function courseRole (rel, { seed = 0, at = [0, 0, 0], moss = true } = {}) {
  if (rel <= 0) return CW.foot
  if (rel === 1) return CW.plinth
  if (rel === 2) return moss && unit(seed, 2, ...at) < CITYWALL.mossBody ? CW.bodym : CW.body
  if (rel === 3) return CW.band
  return moss && unit(seed, 4, ...at) < CITYWALL.mossMerlon ? CW.merlonm : CW.merlon
}
/**
 * UNDERPINNING of a column -> { cells: [[x, y, z]], why } -- the void under its lowest cell filled down to the first ground (at most
 * `max`); none when the cell below is ground already; `why` names a column that cannot be underpinned (water, too deep, unread). Pure.
 */
export function underpinOf (read, col, { max = CITYWALL.underMax, taken = () => false } = {}) {
  const y0 = col.cells[0].at[1]
  const out = []
  for (let y = y0 - 1; y >= y0 - max - 1; y--) {
    const b = read(col.x, y, col.z)
    if (!b) return { cells: [], why: 'unread' }
    if (groundOk(b)) return { cells: out, why: null }
    if (!airish(b)) return { cells: [], why: nm(b) || 'unknown' }
    if (taken(col.x, y, col.z)) return { cells: [], why: 'taken' }
    out.push([col.x, y, col.z])
  }
  return { cells: [], why: 'deep' }
}
/** The first ground top at or below `y` in a column (at most `max` down) -> y | null. Pure. */
export function groundTop (read, x, z, y, max = 12, own = () => false) {
  // the wall's OWN cells are never its ground (a tower over a standing O column starts at the column's ground, not on its top)
  for (let h = y; h >= y - max; h--) { const b = read(x, h, z); if (!b) return null; if (groundOk(b) && !own(x, h, z)) return h }
  return null
}

// ---- towers ----------------------------------------------------------------------------------------------------------------------

/**
 * THE TOWER SITES -> [{ id, cols: [col x3], n: [dx, dz], kind: 'corner' | 'end', at }]. Pure. A corner column that is wall (both its
 * normals: a square bastion on the corner), else, for a gapped corner, the run end nearest it on each side within `reach` (its end
 * column and the two before it, projecting along that side's normal). `fits(site)` vetoes one whose footprint is taken or wet.
 */
export function towerSites (rec, cols, { reach = CITYWALL.cornerReach, max = CITYWALL.towersMax, fits = () => true, skip = new Set() } = {}) {
  const [x0, z0, x1, z1] = rec.ring
  const at = new Map(cols.map(c => [k2(c.x, c.z), c]))
  const corners = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]
  const out = []
  const used = new Set()
  const take = s => { if (out.length >= max || s.cols.some(c => used.has(k2(c.x, c.z)) || skip.has(k2(c.x, c.z))) || !fits(s)) return false; for (const c of s.cols) used.add(k2(c.x, c.z)); out.push(s); return true }
  for (const [cx, cz] of corners) {
    const c = at.get(k2(cx, cz))
    if (c && c.n.length === 2) { take({ id: `T${out.length}`, kind: 'corner', cols: [c], n: c.n, at: [cx, cz] }); continue }
    // a gapped corner: the run end nearest it along each side
    for (const side of outNormals(rec.ring, cx, cz)) {
      const along = side[0] === 0 ? [cx === x0 ? 1 : -1, 0] : [0, cz === z0 ? 1 : -1]
      for (let d = 1; d <= reach; d++) {
        const e = at.get(k2(cx + along[0] * d, cz + along[1] * d))
        if (!e) continue
        const nx = at.get(k2(e.x + along[0], e.z + along[1])), nn = at.get(k2(e.x + 2 * along[0], e.z + 2 * along[1]))
        if (nx && nn) take({ id: `T${out.length}`, kind: 'end', cols: [e, nx, nn], n: side, at: [e.x, e.z] })
        break
      }
    }
  }
  return out
}
/**
 * A TOWER's cells -> { cells: [{ at, role, ws?, blind?, sw? }], top, why }. Pure. The 3 x 3 footprint: for an `end` tower the three
 * in-line columns and two rows out along n; for a `corner` tower the corner and two out along each normal. Each footprint column
 * from its ground (+1) up to the top course tb+towerRise (tb the highest base of its in-line columns); the in-line O cells are
 * SWAPPED (sw); merlons on the four corners and the outer middle at top+1, the lamp on the outer middle merlon, the slit at tb+3 on
 * the outer middle. A column whose ground is not found within reach -> why.
 */
export function towerCells (read, site, { seed = 0, oldAt = new Map(), taken = () => false, rise = CITYWALL.towerRise } = {}) {
  const tb = Math.max(...site.cols.map(c => c.b))
  const top = tb + rise
  const foot = []   // [x, z, kind, a, b]: a, b the footprint indices (0..2)
  if (site.kind === 'corner') {
    const [n1, n2] = site.n, [cx, cz] = site.at
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) foot.push([cx + n1[0] * a + n2[0] * b, cz + n1[1] * a + n2[1] * b, a, b])
  } else {
    const [nx, nz] = site.n
    for (let a = 0; a < 3; a++) for (let o = 0; o < 3; o++) { const c = site.cols[a]; foot.push([c.x + nx * o, c.z + nz * o, a, o]) }
  }
  const cells = []
  let why = null
  const isCorner = (a, b) => (a === 0 || a === 2) && (b === 0 || b === 2)
  const outerMid = (a, b) => (site.kind === 'corner' ? a === 2 && b === 2 : a === 1 && b === 2)
  for (const [x, z, a, b] of foot) {
    const g = groundTop(read, x, z, top, top - tb + 10, (X, Y, Z) => oldAt.has(k3(X, Y, Z)))
    if (g == null) { why = `no_ground ${x},${z}`; break }
    for (let y = g + 1; y <= top; y++) {
      if (taken(x, y, z) && !oldAt.has(k3(x, y, z))) { why = `taken ${x},${y},${z}`; break }
      const centre = site.kind === 'corner' ? a === 1 && b === 1 : a === 1 && b === 1
      let role = centre ? CW.tcore : (site.kind === 'corner' ? (a === 2 || b === 2) && isCorner(a, b) : b === 2 && isCorner(a, b)) ? CW.quoin : CW.tower
      if (outerMid(a, b) && y === tb + 3) role = CW.slit
      const c = { at: [x, y, z], role }
      if (oldAt.has(k3(x, y, z))) c.sw = 1
      // the hidden centre is enclosed by its ring as the tower rises: placed by reach (the roofs' proven blind click), as the top courses
      // above a ground eye's top-face reach (its ground + 3: the course a builder on the ground cannot see the top of) and the hidden
      // centre (enclosed by its ring as the tower rises): placed by reach (the roofs' proven blind click, Paper 147/147)
      if (y >= g + 3 || role === CW.tcore) c.blind = true
      cells.push(c)
    }
    if (why) break
    if (isCorner(a, b) || outerMid(a, b)) cells.push({ at: [x, top + 1, z], role: CW.tmerlon, blind: true })
    if (outerMid(a, b)) cells.push({ at: [x, top + 2, z], role: CW.lamp, blind: true })
  }
  // an old cell of the in-line columns above the new top (a merlon over a low base) is kept as tower body
  return { cells, top, why }
}

// ---- the gatehouse -----------------------------------------------------------------------------------------------------------------

/**
 * THE GATE SITE -> { gate, cols: [[x, z]], n, along, P, lo, hi } | null. Pure. One of the record's gateways (`rec.gates`, a run of ring
 * columns on one side): `pick` (a `why` such as 'road', or an index), else the widest. Its flank columns -- the ring columns just past
 * each end -- carry the towers; `along` is the side's direction, `n` its outward normal.
 */
export function gateSite (rec, { pick = null } = {}) {
  const gates = (rec?.gates ?? []).filter(g => Array.isArray(g.cols) && g.cols.length >= 2 && g.cols.length <= CITYWALL.gateMaxP)
  if (!gates.length) return null
  let g = null
  if (Number.isInteger(pick)) g = gates[pick] ?? null
  else if (typeof pick === 'string') g = gates.find(q => q.why === pick) ?? null
  else g = gates.slice().sort((a, b) => b.cols.length - a.cols.length)[0]
  if (!g) return null
  const a = g.cols[0], b = g.cols.at(-1)
  const along = a[0] === b[0] ? [0, Math.sign(b[1] - a[1])] : [Math.sign(b[0] - a[0]), 0]
  const ns = outNormals(rec.ring, a[0], a[1]).filter(n => n[0] * along[0] + n[1] * along[1] === 0)
  if (!ns.length) return null
  return { gate: g, cols: g.cols, n: ns[0], along, P: g.cols.length, lo: [a[0] - along[0], a[1] - along[1]], hi: [b[0] + along[0], b[1] + along[1]] }
}
/** THE INSET form of a wide gateway (P >= GATE_INSET_MIN): its towers stand on the gateway's own end columns, the passage is the
 *  middle P - 6 (a flank past the end that is another record's or a reservation's: the gate stays in its own footprint). Pure. */
export const GATE_INSET_MIN = 11
export function gateInset (site) {
  if (!site || site.P < GATE_INSET_MIN) return null
  const cols = site.cols.slice(3, site.P - 3)
  return { ...site, cols, P: cols.length, lo: site.cols[2], hi: site.cols[site.P - 3], inset: true }
}
/**
 * THE GATEHOUSE's cells -> { cells, deckY, g, towers: [site, site], why }. Pure. Two flanking towers (3 in-line columns past each end of
 * the passage, 2 rows out: towerCells, their top raised to deck + 1), the DECK at g+head+1 over the passage on rows 0..2 out (g the
 * highest ground there), merlons on alternate columns of its outer row, a parapet on its inner row, the keystone at the outer face's
 * centre, haunch stairs under the deck at the passage's two edge columns (outer and inner row) and lanterns hung under the outer row
 * every third column. `cols(x, z)` -> the record's wall column there (for the in-line flank columns' bases and old cells).
 */
export function gatehouseCells (read, site, { seed = 0, colAt = () => null, oldAt = new Map(), taken = () => false, head = CITYWALL.gateHead, stairs = true, top0 = null } = {}) {
  // the scan's start: above the flank columns' bases (the passage's ground is near them), else above the highest record cell
  top0 ??= Math.max(...[site.lo, site.hi].map(([x, z]) => colAt(x, z)?.b ?? -Infinity), ...[...oldAt.values()].map(c => c.at[1])) + 8
  const [nx, nz] = site.n, [ax, az] = site.along
  const pass = []
  for (let o = 0; o < 3; o++) for (const [x, z] of site.cols) pass.push([x + nx * o, z + nz * o])
  let g = -Infinity
  for (const [x, z] of pass) { const t = groundTop(read, x, z, top0, 24, (X, Y, Z) => oldAt.has(k3(X, Y, Z))); if (t == null) return { cells: [], why: `no_ground ${x},${z}` }; g = Math.max(g, t) }
  const deckY = g + head + 1
  // the flank towers: 3 columns past each end along the side (a column the record has no wall in gets a base from its ground)
  const flank = (from, dir) => {
    const cs = []
    for (let d = 0; d < 3; d++) {
      const x = from[0] + dir[0] * d, z = from[1] + dir[1] * d
      const c = colAt(x, z)
      const gt = groundTop(read, x, z, deckY + 6, 20, (X, Y, Z) => oldAt.has(k3(X, Y, Z)))
      cs.push(c ?? { x, z, b: gt ?? g, cells: [] })
    }
    return { id: 'G', kind: 'end', cols: cs, n: site.n, at: [from[0], from[1]] }
  }
  // an inset gate's towers stand on the gateway's end columns (lo/hi are the last tower columns, the towers run back toward the ends)
  const tA = flank(site.lo, [-ax, -az]), tB = flank(site.hi, [ax, az])
  const cells = []
  for (const t of [tA, tB]) {
    const rise = Math.max(CITYWALL.towerRise, deckY + 1 - Math.max(...t.cols.map(c => c.b)))
    const tc = towerCells(read, t, { seed, oldAt, taken, rise })
    if (tc.why) return { cells: [], why: `tower ${tc.why}` }
    cells.push(...tc.cells)
  }
  const mid = Math.floor((site.P - 1) / 2)
  site.cols.forEach(([x, z], i) => {
    for (let o = 0; o < 3; o++) {
      const X = x + nx * o, Z = z + nz * o
      cells.push({ at: [X, deckY, Z], role: o === 2 && i === mid ? CW.key : o === 2 ? CW.dedge : CW.deck })
      if (o === 2 && i % 2 === 0) cells.push({ at: [X, deckY + 1, Z], role: CW.tmerlon, blind: true })
      if (o === 0) cells.push({ at: [X, deckY + 1, Z], role: CW.parapet, blind: true })
      const edge = i === 0 || i === site.P - 1
      if (edge && stairs && (o === 0 || o === 2)) {
        // the haunch faces the tower it springs from (its full side against the tower: the arch's corner)
        const toward = i === 0 ? [-ax, -az] : [ax, az]
        cells.push({ at: [X, deckY - 1, Z], role: CW.haunch, ws: { facing: facingOf(toward), half: 'top' } })
      }
      // the gate's lights STAND on its parapet's posts (inner row, every third column): a lantern hung under the deck needs the
      // underside click this base's solver never takes (buildsite.mjs SUPPORTS)
      if (o === 0 && i % 3 === 1) cells.push({ at: [X, deckY + 2, Z], role: CW.lamp, blind: true })
    }
  })
  return { cells, deckY, g, towers: [tA, tB], why: null }
}
/** [dx, dz] -> a facing name. Pure. */
export const facingOf = ([dx, dz]) => (dx > 0 ? 'east' : dx < 0 ? 'west' : dz > 0 ? 'south' : 'north')

// ---- the lamps ----------------------------------------------------------------------------------------------------------------------

/** THE RUN-END LAMPS -> [{ at, role }]: one on the top merlon of each run's end columns (a run of one: one lamp), never on a taken
 *  cell, never within CITYWALL.lampIceR of ice (a lantern melts the lake the bots swim). Pure. */
export function runLamps (read, runs, { taken = () => false, skip = new Set(), iceR = CITYWALL.lampIceR } = {}) {
  const out = []
  const icy = (x, y, z) => { for (let dx = -iceR; dx <= iceR; dx++) for (let dz = -iceR; dz <= iceR; dz++) for (let dy = -2; dy <= 1; dy++) if (/ice$/.test(nm(read(x + dx, y + dy, z + dz)))) return true; return false }
  for (const r of runs) {
    const ends = r.length === 1 ? [r[0]] : [r[0], r.at(-1)]
    for (const c of ends) {
      if (skip.has(k2(c.x, c.z))) continue
      const t = c.cells.at(-1).at
      if (t[1] < c.b + 4) continue   // no merlon at this end
      const at = [t[0], t[1] + 1, t[2]]
      if (taken(...at) || !airish(read(...at)) || icy(...at)) continue
      out.push({ at, role: CW.lamp, blind: true })
    }
  }
  return out
}

// ---- the design ---------------------------------------------------------------------------------------------------------------------

/**
 * THE DESIGN of one wall record -> { ok, why, style, seed, cells: [cell + { seg, ph }], phases: [{ ph, segs, kind, bill }], towers, gate,
 * counts }. Pure over `read`. Every O cell of the record swapped to its course (sw), the underpinning, the towers, the gatehouse (when
 * `gatePick` names one, or `gate` is true: the widest), the lamps. Each cell carries its segment (the run's own W-<nn> for its
 * courses, underpinning and lamps; CW-T<i> a tower; CW-G the gatehouse) and its phase. `taken(x, y, z)` vetoes a cell another record
 * owns (a dress torch, a path); the old record's own cells are never taken.
 */
export function citywallDesign (read, rec, { style = 'grey', seed = 0, moss = true, gate = false, gatePick = null, taken = () => false, zone = () => false, towersMax = CITYWALL.towersMax, stairs = true } = {}) {
  if (!rec?.cells?.length || !Array.isArray(rec.ring)) return { ok: false, why: 'no_record' }
  if (rec.citywall) return { ok: false, why: 'already' }
  const cols = wallColumns(rec)
  if (!cols.length) return { ok: false, why: 'no_columns' }
  const runs = wallRuns(cols)
  const oldAt = new Map((rec.cells ?? []).map(c => [kOf(c.at), c]))
  const own = (x, y, z) => oldAt.has(k3(x, y, z))
  // a cell another record owns, or a NEW cell in a reservation (a land road corridor, a protected zone): never the design's
  const veto = (x, y, z) => !own(x, y, z) && (!!taken(x, y, z) || !!zone(x, z))
  const colAt = (() => { const m = new Map(cols.map(c => [k2(c.x, c.z), c])); return (x, z) => m.get(k2(x, z)) ?? null })()
  const cells = new Map()   // "x,y,z" -> cell
  const put = (c, seg, ph) => { const k = kOf(c.at); const o = oldAt.get(k); cells.set(k, { ...c, seg, ph, ...(o ? { sw: 1, old: o.role, oldSeg: o.seg } : {}) }) }
  const skipped = { underpin: {}, towers: [], gate: null }
  // 1. THE GATEHOUSE (phase 0) and its flank towers
  let gh = null
  const towerCols = new Set()
  if (gate || gatePick != null) {
    let site = gateSite(rec, { pick: gatePick })
    if (site) {
      let r = gatehouseCells(read, site, { seed, colAt, oldAt, taken: veto, stairs })
      const ins = r.why ? gateInset(site) : null
      if (ins) { const r2 = gatehouseCells(read, ins, { seed, colAt, oldAt, taken: veto, stairs }); if (!r2.why) { r = r2; site = ins } else r = { ...r, why: `${r.why}; inset ${r2.why}` } }
      if (r.why) skipped.gate = r.why
      else { gh = { site, ...r }; for (const t of r.towers) for (const c of t.cols) towerCols.add(k2(c.x, c.z)) }
    } else skipped.gate = 'no_gateway'
  }
  // 2. THE TOWERS (one phase each, after the gate)
  const footprintFree = s => {
    const tc = towerCells(read, s, { seed, oldAt, taken: veto })
    if (tc.why) { skipped.towers.push(`${s.at.join(',')}:${tc.why}`); return false }
    return true
  }
  const sites = towerSites(rec, cols, { max: towersMax, fits: footprintFree, skip: towerCols })
  // 3. THE PHASES: the gate's unit, each tower's unit (its run), then the other runs nearest a tower or the gate first
  const runOf = new Map(); runs.forEach((r, i) => { for (const c of r) runOf.set(k2(c.x, c.z), i) })
  const units = []
  if (gh) units.push({ kind: 'gate', runs: new Set(gh.towers.flatMap(t => t.cols.map(c => runOf.get(k2(c.x, c.z))).filter(v => v != null))), site: gh })
  for (const s of sites) units.push({ kind: 'tower', runs: new Set(s.cols.map(c => runOf.get(k2(c.x, c.z))).filter(v => v != null)), site: s })
  const claimed = new Set()
  for (const u of units) for (const r of u.runs) { if (claimed.has(r)) u.runs.delete(r); else claimed.add(r) }
  const anchors = units.map(u => (u.kind === 'gate' ? u.site.site.cols[0] : u.site.at))
  const rest = runs.map((r, i) => i).filter(i => !claimed.has(i))
    .map(i => ({ i, d: Math.min(...runs[i].map(c => Math.min(Infinity, ...anchors.map(a => Math.abs(a[0] - c.x) + Math.abs(a[1] - c.z))))) }))
    .sort((p, q) => p.d - q.d || p.i - q.i)
  for (const { i } of rest) units.push({ kind: 'run', runs: new Set([i]) })
  // 4. THE CELLS per unit
  const lampSkip = new Set(towerCols)
  for (const s of sites) for (const c of s.cols) lampSkip.add(k2(c.x, c.z))
  units.forEach((u, ph) => {
    // the gate towers' lamps go up LAST, from the finished deck (a ground eye cannot reach a lamp over a raised tower: offline 11-09)
    // A TOWER'S SWAPPED CELLS (its in-line O column) go FIRST, in their own segment `<tower>s`: the swap digs them from the outside ground
    // and once the tower's outer rows stand round them no stand sees them (the fake server 11-09: clear_failed no_stand, blocked)
    const swFirst = (c, seg) => (oldAt.has(kOf(c.at)) ? `${seg}s` : seg)
    // ...and the haunch stairs with them (a part with no fallback: a visit that holds none ends `no_material` at it, so it goes in the
    // gate's LAST segment -- the wall's lights-last rule, wall.mjs wallLightsLast -- never ahead of the deck and the runs)
    if (u.kind === 'gate') for (const c of u.site.cells) put(c, c.role === CW.lamp || c.role === CW.haunch ? 'CW-GL' : c.role === CW.deck || c.role === CW.dedge || c.role === CW.key || c.role === CW.hang || (c.role === CW.tmerlon && c.at[1] === u.site.deckY + 1) || c.role === CW.parapet ? 'CW-G' : swFirst(c, 'CW-GT'), ph)
    if (u.kind === 'tower') { const tc = towerCells(read, u.site, { seed, oldAt, taken: veto }); for (const c of tc.cells) put(c, swFirst(c, `CW-${u.site.id}`), ph) }
    for (const ri of u.runs) {
      const run = runs[ri]
      for (const col of run) {
        const k = k2(col.x, col.z)
        if (towerCols.has(k) || sites.some(s => s.cols.some(c => c.x === col.x && c.z === col.z))) continue
        for (const c of col.cells) { const rel = c.at[1] - col.b; if (c.role === 'post') continue; if (!cells.has(kOf(c.at))) put({ at: c.at, role: courseRole(rel, { seed, at: c.at, moss }) }, col.seg, ph) }
        const up = underpinOf(read, col, { taken: veto })
        if (up.why) skipped.underpin[up.why] = (skipped.underpin[up.why] ?? 0) + 1
        for (const at of up.cells) if (!cells.has(kOf(at))) put({ at, role: CW.foot }, col.seg, ph)
      }
      for (const l of runLamps(read, [run], { taken: veto, skip: lampSkip })) if (!cells.has(kOf(l.at))) put(l, `CW-L${ph}`, ph)
    }
  })
  const all = [...cells.values()]
  const phases = units.map((u, ph) => {
    const mine = all.filter(c => c.ph === ph)
    return { ph, kind: u.kind, segs: [...new Set(mine.map(c => c.seg))], n: mine.length, bill: citywallBill(mine, style), clear: designClears(read, mine) }
  }).filter(p => p.n > 0)
  const counts = { columns: cols.length, runs: runs.length, swapped: all.filter(c => c.sw).length, added: all.filter(c => !c.sw).length, underpin: all.filter(c => c.role === CW.foot && !c.sw).length, towers: sites.length, gate: gh ? gh.site.P : 0, lamps: all.filter(c => c.role === CW.lamp || c.role === CW.hang).length }
  return { ok: true, why: null, style, seed, cells: all, phases, towers: sites.map(s => ({ id: s.id, kind: s.kind, at: s.at, n: s.n })), gate: gh ? { cols: gh.site.cols, P: gh.site.P, deckY: gh.deckY, g: gh.g, why: gh.site.gate.why } : null, counts, skipped }
}
/**
 * THE CLEARS a phase owes -> [{ at, kind: 'tree' | 'leaves', name }]. Pure. A tree standing in a NEW cell (a spruce in a gateway's deck,
 * on a tower's footprint) is felled WHOLE -- every log connected to the one in the cell (26 neighbours, at most `max`), the wall
 * siting's rule (wall.mjs: a trunk in a column is felled whole, no replant owed) -- and leaves in a new cell are cleared.
 */
export const CLEAR_TRUNK_MAX = 64
export function designClears (read, cells, { max = CLEAR_TRUNK_MAX } = {}) {
  const out = new Map()
  const LOG = /_(log|wood)$/, LEAF = /_leaves$/
  for (const c of cells) {
    if (c.sw) continue
    const n = nm(read(...c.at))
    if (LEAF.test(n)) { out.set(kOf(c.at), { at: c.at, kind: 'leaves', name: n }); continue }
    if (!LOG.test(n)) continue
    const q = [c.at], seen = new Set([kOf(c.at)])
    for (let h = 0; h < q.length && seen.size <= max; h++) {
      const [x, y, z] = q[h]
      out.set(k3(x, y, z), { at: [x, y, z], kind: 'tree', name: nm(read(x, y, z)) })
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        const k = k3(x + dx, y + dy, z + dz)
        if (seen.has(k) || !LOG.test(nm(read(x + dx, y + dy, z + dz)))) continue
        seen.add(k); q.push([x + dx, y + dy, z + dz])
      }
    }
  }
  return [...out.values()]
}
/** A cell list's bill -> { name: n } by each role's FIRST name. Pure. */
export function citywallBill (cells, style = 'grey') {
  const pal = citywallPalette(style)
  const out = {}
  for (const c of cells) { const n = (pal[c.role] ?? [])[0]; if (n) out[n] = (out[n] ?? 0) + 1 }
  return out
}

// ---- the generations ------------------------------------------------------------------------------------------------------------------

/**
 * THE NEXT PHASE -> { ph, why } | { ph: null, why }. Pure. The record's design (`rec.citywall`) publishes its phases in order: the next
 * one only when every cell of the phases already published reads done (`done(cell)`, the visit's own rule) and the town's known stock
 * (`stock` { name: n }, minus `keep`) covers its bill (each name, or the role's later names: a deepslate plinth laid in stone bricks
 * is accepted). No stock read: wait.
 */
export function citywallNext (rec, { done = () => false, stock = null, keep = {} } = {}) {
  const cw = rec?.citywall
  if (!cw?.design) return { ph: null, why: 'no_design' }
  const next = (cw.phase ?? -1) + 1
  const ph = cw.design.phases.find(p => p.ph >= next)
  if (!ph) return { ph: null, why: 'all_published' }
  const open = (rec.cells ?? []).filter(c => Number.isInteger(c.ph) && c.ph <= (cw.phase ?? -1) && !done(c))
  if (open.length) return { ph: null, why: `open:${open.length}` }
  if (!stock) return { ph: null, why: 'stock_unknown' }
  const short = stockShort(ph.bill, stock, keep, cw.style)
  if (Object.keys(short).length) return { ph: null, why: `stock:${Object.entries(short).map(([k, v]) => `${k}:${v}`).join(',')}` }
  return { ph: ph.ph, why: null }
}
/** What the town lacks for a bill -> { name: missing }. A name's shortfall may be met by another name the same roles accept. Pure. */
export function stockShort (bill, stock, keep = {}, style = 'grey') {
  const pal = citywallPalette(style)
  const avail = Object.fromEntries(Object.entries(stock ?? {}).map(([k, v]) => [k, Math.max(0, (Number(v) || 0) - (Number(keep[k]) || 0))]))
  const alts = n => [...new Set(Object.values(pal).filter(l => l[0] === n).flatMap(l => l.slice(1)))]
  const short = {}
  for (const [n, want] of Object.entries(bill)) {
    let left = want
    const use = (name) => { const t = Math.min(left, avail[name] ?? 0); avail[name] = (avail[name] ?? 0) - t; left -= t }
    use(n)
    for (const a of alts(n)) if (left > 0) use(a)
    if (left > 0) short[n] = left
  }
  return short
}
/**
 * THE GENERATION adding phase `ph` -> the new record. Pure. The record's cells with the phase's design cells laid over them (a swapped
 * cell takes its course role in place; an added cell is appended), the phase's new segments ordered gate, towers, runs, lamps (a run's
 * own W-<nn> keeps its place), the style's palette and `citywall` { v, style, seed, phase, design } (cottage.mjs recordPalette reads the
 * palette by it: the visit, the bill and the damage read judge by it; no `style`, so reroof's one-at-a-time never waits on it). The record stays `structure_complete`: the open cells are the upgrade's work (read as
 * damage, built by the wall's own visit, swapped by its `swap` rule).
 */
export function citywallGeneration (rec, design, ph, { now = Date.now() } = {}) {
  const add = design.cells.filter(c => c.ph === ph)
  const byK = new Map(add.map(c => [kOf(c.at), c]))
  const strip = c => { const { old, oldSeg, ...rest } = c; return rest }
  const cells = (rec.cells ?? []).map(c => (byK.has(kOf(c.at)) ? strip(byK.get(kOf(c.at))) : c))
  const have = new Set(cells.map(c => kOf(c.at)))
  for (const c of add) if (!have.has(kOf(c.at))) cells.push(strip(c))
  const used = new Set(cells.map(c => c.seg))
  const rank = s => (/^CW-GTs$/.test(s) ? -0.5 : /^CW-GT$/.test(s) ? 0 : /^CW-G$/.test(s) ? 1 : /^CW-GL$/.test(s) ? 1.5 : /^CW-T\d+s$/.test(s) ? 1.8 : /^CW-T/.test(s) ? 2 : /^CW-L/.test(s) ? 4 : 3)
  const knownSeg = new Set((rec.segments ?? []).map(s => s.seg))
  const segs = [...(rec.segments ?? []).filter(s => used.has(s.seg)), ...[...used].filter(s => !knownSeg.has(s)).map(s => ({ seg: s, deps: [] }))]
  const order = segs.map((s, i) => ({ s, i })).sort((a, b) => rank(a.s.seg) - rank(b.s.seg) || a.i - b.i).map(q => q.s)
  // the gate's deck waits on its flank towers (a deck cell is clicked on a tower's side face)
  // and a tower's outer rows wait on its swapped in-line cells (`<tower>s`)
  const depOf = sg => (sg === 'CW-G' ? 'CW-GT' : sg === 'CW-GL' ? 'CW-G' : /^CW-(GT|T\d+)$/.test(sg) ? `${sg}s` : null)
  const segments = order.map(s => { const d = depOf(s.seg); return d && used.has(d) ? { ...s, deps: [...new Set([...(s.deps ?? []), d])] } : s })
  const prev = rec.citywall ?? null
  // the phase's clears (a tree in a new cell, felled whole) join the record's list: the visit fells them first, the tripwire judges them
  const pc = (design.phases.find(p => p.ph === ph)?.clear ?? [])
  const known = new Set((rec.clear ?? []).map(c => kOf(c.at)))
  const clear = [...(rec.clear ?? []), ...pc.filter(c => !known.has(kOf(c.at)))]
  return {
    ...rec, cells, segments, clear,
    palette: citywallPalette(design.style),
    citywall: { v: 1, style: design.style, seed: design.seed, phase: ph, at: now, design: prev?.design ?? { phases: design.phases, cells: design.cells.map(strip), towers: design.towers, gate: design.gate, counts: design.counts } },
  }
}
/** A design's cells kept in the record (citywallGeneration stores them stripped) -> the design object again for the next phase. Pure. */
export const designOf = rec => (rec?.citywall?.design ? { style: rec.citywall.style, seed: rec.citywall.seed, ...rec.citywall.design } : null)
/** What the town keeps back from a phase's bill (the stoneworks' and the market's own buffers stay theirs). */
export const CITYWALL_KEEP = Object.freeze({ stone_bricks: 64, deepslate_bricks: 32, lantern: 4, iron_bars: 0 })
/**
 * THE GATEWAY a ring's gatehouse goes over -> a `gatePick` (a gateway's `why`) | null. CITYWALL_GATE=<why>|none; unset: the showcase's
 * extension takes its ROAD gateway (the owner's "a gatehouse at the main road": the record's only `road` gateway), every other ring
 * its widest path gateway ('path'). Pure.
 */
export function citywallGatePick (env = process.env, plot = '') {
  const v = String(env?.CITYWALL_GATE ?? '').trim()
  if (/^(none|off|-)$/i.test(v)) return null
  if (v) return v
  return plot === 'wallext' ? 'road' : 'path'
}
/** THE STYLE from the town's stock -> 'grey' | 'dark'. Pure. CITYWALL_STYLE names one; else grey (a stone-brick face) unless the town
 *  holds fewer than 200 stone bricks and over 1,000 deepslate bricks and cobbled deepslate (fuel-free deepslate bricks: the fleet). */
export const STYLE_DARK_AT = Object.freeze({ stoneBelow: 200, deepslateOver: 1000 })
export function citywallStyleFor (stock = {}, pool = '', env = process.env) {
  const v = String(env?.CITYWALL_STYLE ?? '').trim()
  if (WALL_STYLES[v]) return v
  const sb = Number(stock?.stone_bricks) || 0, ds = (Number(stock?.deepslate_bricks) || 0) + (Number(stock?.cobbled_deepslate) || 0)
  return sb < STYLE_DARK_AT.stoneBelow && ds > STYLE_DARK_AT.deepslateOver ? 'dark' : 'grey'
}
/** Is this visit's record a citywall generation (the wall visit's `swap` rule and palette)? Pure. */
export const isCitywall = rec => !!(rec?.citywall && typeof rec.citywall === 'object')
