// PIT-01SHOW (OWNER 11-19, "P1 North Pit" from docs/reports/sites-2026-11-19/sites.md + map.png): THE TOWN'S DIRT BORROW PIT.
// The ground near town has been stripped of dirt; the owner picked a 15x21 site at (-51, -99) on the north point -- flat, grass on
// 3-4 blocks of earth over stone, ~710 dirt to 3 down -- with the frozen sea 3 blocks off its east rim. His rules for it:
//   * it becomes a DESIGNED shape -- a curved cove pond -- never a raw hole (the shape below: a curved outline, 1:1 banks, a flat floor);
//   * the owner's landscape rules: designed ground, easy to walk (every step of the finished bowl, and of every stage of the dig, is 1);
//   * A SEA-BREACH GUARD: no cell is dug that would open to the sea or let water in uncontrolled; a solid rim stays between the pit
//     and any water until the deliberate pond finish (docs/reports/pit/finish-plan.md: a later piece, not this one);
//   * it is dug only while the town is SHORT of dirt for a named consumer (the tidy's fills, the grade, the storehouse's level): never
//     stock for its own sake.
//
// PURE: the switch and the site, the plan (outline, keep-out rim, target heights, the cells by layer, the yield), the record, what a
// visit may dig now (the layer gate and the guard), the demand, the bank's order, the rows. skills.mjs buildPit reads the world,
// runs the dig through buildrun.mjs runVisit (the normal clear-dig visit) and banks the dirt; scripts/host/pitplan.mjs runs pitPlan
// over a region copy for the pictures (docs/reports/pit/).
//
// THE SITE IS THE SWITCH (no coordinates in the code: any world, any site):
//   PIT_SITE=<cx>,<cz>,<w>,<l>/<floor>   the outline's centre, its width (x) and length (z), the floor's top block level
//   e.g. PIT_SITE=-51,-99,15,21/60.  Unset: the town's site file decides (`town-site.json` key `pit`: { centre: [cx, cz], size: [w, l],
//   floor }); none: no project.  off | 0 | false | no: no project whatever the file says.  Unreadable: no project.

const isOff = v => ['', 'off', '0', 'false', 'no'].includes(String(v ?? '').trim().toLowerCase())
export const PIT_PLOT = 'pit'
export const PIT_BLUEPRINT = 'pit@1'
export const PIT_BUILDERS = 2
export const PIT_HALVES = Object.freeze(['W', 'E'])
export const PIT = Object.freeze({
  rim: 3,          // solid columns kept between the dig and any water (the outline's columns closer than this to water are never dug)
  guardUp: 2,      // the live guard's box round a cell: +-rim across, this far up ...
  guardDown: 2,    // ... and this far down (an aquifer under the floor counts)
  scanUp: 14,      // the plan reads the ground this far above the floor ...
  scanDown: 4,     // ... and this far below it
  margin: 7,       // the columns round the outline the plan reads (the banks' reference ground, the water near the rim)
  visitMax: 48,    // dig cells one visit tries (buildrun clearMax)
  keep: 16,        // dirt the bag keeps (towndeposit.mjs HELD_TARGETS.dirt: the gather chain's floor)
  bankMin: 32,     // a visit banks once the bag holds this much dirt above the keep (or the dig has nothing left for it)
  demandMs: 5 * 60_000,   // a demand reading serves this long
  perchMax: 4,     // a run of solid blocks this thick or thinner with air under it is a leftover over the ground, not the ground
  missMax: 2,      // visits that dig nothing of a cell's layer before the cell is set aside (`unreached`: no stand reaches it)
})
export const EARTH = Object.freeze(['grass_block', 'dirt', 'coarse_dirt', 'podzol', 'rooted_dirt', 'mycelium', 'dirt_path', 'farmland', 'mud'])
const EARTH_SET = new Set(EARTH)
// the ground a pit may take: earth, the stone family, loose ground, ores in it, a bot's own cobble, leaves lying on it -- never a built
// block, a log, a liquid
const DIGGABLE = /^([a-z_]*_leaves|grass_block|dirt|coarse_dirt|podzol|rooted_dirt|mycelium|dirt_path|farmland|mud|clay|gravel|sand|red_sand|stone|granite|diorite|andesite|tuff|calcite|deepslate|cobblestone|cobbled_deepslate|mossy_cobblestone|snow_block|[a-z_]*_ore)$/
// what lies on the ground and is not ground (the top is found under it): plants, snow, floating canopy, the air
const SOFT = /^(air|cave_air|void_air|short_grass|tall_grass|grass|fern|large_fern|snow|dead_bush|[a-z_]*_sapling|[a-z_]*_leaves|vine|glow_lichen|dandelion|poppy|[a-z_]*_tulip|azure_bluet|oxeye_daisy|cornflower|allium|blue_orchid|lily_of_the_valley|[a-z_]*_mushroom|sweet_berry_bush|pink_petals|leaf_litter|torch|wall_torch)$/
const LIQUID = /^(water|flowing_water|lava|flowing_lava|bubble_column|kelp|kelp_plant|seagrass|tall_seagrass|ice|packed_ice|blue_ice|frosted_ice)$/
const nm = b => String(b?.name ?? '').replace(/\[.*\]$/, '')
const wl = b => b?.props?.waterlogged === true || b?.props?.waterlogged === 'true' || /\[.*waterlogged=true/.test(String(b?.name ?? ''))
/** Water (or ice that becomes water, a water plant, a waterlogged block) or lava. Pure. */
export const isLiquidish = b => !!b && (LIQUID.test(nm(b)) || wl(b))
export const isEarth = b => !!b && EARTH_SET.has(nm(b))
export const isSoft = b => !!b && SOFT.test(nm(b)) && !wl(b)
export const isDiggable = b => !!b && DIGGABLE.test(nm(b)) && !wl(b)

const INT = /^-?\d+$/
/** THE SITE of the switch -> { cx, cz, w, l, floor } | null (off, or unreadable: a site that cannot be read is never guessed). Pure. */
export function pitSiteOf (env = {}) {
  const v = env?.PIT_SITE
  if (isOff(v)) return null
  const [a, f, ...rest] = String(v).split('/')
  const p = String(a ?? '').split(',').map(s => s.trim())
  if (rest.length || p.length !== 4 || !p.every(s => INT.test(s)) || !INT.test(String(f ?? '').trim())) return null
  const [cx, cz, w, l] = p.map(Number), floor = Number(String(f).trim())
  if (w < 5 || l < 5 || w > 41 || l > 41 || floor < -60 || floor > 300) return null
  return { cx, cz, w, l, floor }
}
export const pitSiteEnvOff = (env = {}) => ['off', '0', 'false', 'no'].includes(String(env?.PIT_SITE ?? '').trim().toLowerCase())
/** The site of the town's site file (`json.pit` = { centre: [cx, cz], size: [w, l], floor }) -> site | null; another home's file: null. */
export function pitSiteOfSeed (json, home = null) {
  try {
    const s = json?.pit
    if (!s || typeof s !== 'object' || Array.isArray(s)) return null
    const h = Array.isArray(json.home) ? { x: json.home[0], y: json.home[1], z: json.home[2] } : json.home
    if (home && h && (h.x !== home.x || h.y !== home.y || h.z !== home.z)) return null
    const two = a => Array.isArray(a) && a.length === 2 && a.every(Number.isSafeInteger)
    if (!two(s.centre) || !two(s.size) || !Number.isSafeInteger(s.floor)) return null
    return pitSiteOf({ PIT_SITE: `${s.centre[0]},${s.centre[1]},${s.size[0]},${s.size[1]}/${s.floor}` })
  } catch { return null }
}
/** This process's site (pitsitefile.mjs replaces it at load with the environment's or the town file's). */
export const PITSITE = { site: pitSiteOf(typeof process !== 'undefined' ? process.env : {}), get on () { return !!this.site } }

// ---- THE SHAPE --------------------------------------------------------------------------------------------------------------
/**
 * THE COVE'S OUTLINE -> Set "x,z". Pure. An ellipse w x l round the centre whose radius swells and narrows gently with the angle
 * (two low harmonics: a pond's curve, never a box or a perfect oval), then smoothed: a column with fewer than two outline neighbours
 * (a spike) is dropped until none is left.
 */
export function coveOutline (site) {
  const a = site.w / 2, b = site.l / 2, out = new Set()
  for (let dz = -Math.ceil(b * 1.2); dz <= Math.ceil(b * 1.2); dz++) {
    for (let dx = -Math.ceil(a * 1.2); dx <= Math.ceil(a * 1.2); dx++) {
      const th = Math.atan2(dz / b, dx / a)
      const r = 1 + 0.09 * Math.sin(2 * th + 0.6) + 0.06 * Math.sin(3 * th + 1.9)
      if ((dx / a) ** 2 + (dz / b) ** 2 <= r * r) out.add(`${site.cx + dx},${site.cz + dz}`)
    }
  }
  return smooth(out)
}
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]]
function smooth (set) {
  let s = new Set(set), changed = true
  while (changed) {
    changed = false
    for (const k of [...s]) {
      const [x, z] = k.split(',').map(Number)
      if (N4.filter(([dx, dz]) => s.has(`${x + dx},${z + dz}`)).length < 2) { s.delete(k); changed = true }
    }
  }
  return s
}
function largestPiece (set) {
  const seen = new Set()
  let best = new Set()
  for (const k of set) {
    if (seen.has(k)) continue
    const piece = new Set([k]), q = [k]
    seen.add(k)
    for (let i = 0; i < q.length; i++) {
      const [x, z] = q[i].split(',').map(Number)
      for (const [dx, dz] of N4) { const n = `${x + dx},${z + dz}`; if (set.has(n) && !seen.has(n)) { seen.add(n); piece.add(n); q.push(n) } }
    }
    if (piece.size > best.size) best = piece
  }
  return best
}
const cheb = (x0, z0, x1, z1) => Math.max(Math.abs(x0 - x1), Math.abs(z0 - z1))

/**
 * ONE COLUMN READ -> { g, wet, unread, trunk, top, perched: [y] }. Pure over `read`. From floor + scanUp down to floor - scanDown: the
 * first block that is not soft is the ground (`g`, its name `top`); a liquid there (or ice) is WATER (`wet`: its level); a log
 * standing on the ground is a `trunk` (digging under it would leave it hanging). A block with air under it is PERCHED (a bot's leftover
 * or a felled tree's canopy: not the ground) -- a log or leaves is passed over, ground (`perched`) is listed: the pit takes it first. A
 * null read anywhere above the ground: `unread`.
 */
export function columnOf (read, x, z, floor, T = PIT) {
  const perched = []
  for (let y = floor + T.scanUp; y >= floor - T.scanDown; y--) {
    const b = read(x, y, z)
    if (!b) return { unread: true }
    if (isSoft(b)) continue
    if (isLiquidish(b)) return { g: y, wet: y, top: nm(b), perched }
    const log = /_(log|wood|stem)$/.test(nm(b))
    let y0 = y
    if (log) while (/_(log|wood|stem)$/.test(nm(read(x, y0 - 1, z)))) y0--   // the trunk's lowest log
    else while (y0 > y - T.perchMax + 1 && (() => { const q = read(x, y0 - 1, z); return !!q && !isSoft(q) && !isLiquidish(q) })()) y0--   // a run of up to perchMax solids
    const u = read(x, y0 - 1, z)
    if (!u) return { unread: true }
    if (isSoft(u)) {   // over air: not the ground (a floating trunk passed whole; a floating run of ground listed, to be taken)
      if (!log) for (let q = y; q >= y0; q--) if (isDiggable(read(x, q, z))) perched.push(q)
      y = y0; continue
    }
    if (log) return { g: y0 - 1, trunk: true, top: nm(u), perched }
    return { g: y, top: nm(b), perched }
  }
  return { g: floor - T.scanDown - 1, top: 'deep', perched }
}

/**
 * THE PLAN -> { ok, why?, site, outline: ["x,z"], pit: ["x,z"], rim: [[x, z, why]], held: [[x, z, why]], cols: [{ x, z, g, t }],
 * cells: [{ at, e, h }], layers: [{ y, n, dirt }], dirt, other, water, steps2, unread }. Pure over `read`.
 *   OUTLINE   coveOutline.
 *   KEEP-OUT  an outline column within T.rim (Chebyshev) of ANY water column in the box -- whatever its height -- is the RIM: never
 *             dug (the sea-breach guard's plan half; the live half is pitGuard). A column holding water or a standing trunk is held,
 *             and the rim round water inside the outline too. Of what is left, the largest 4-connected piece, smoothed.
 *   TARGET    the finished top of each pit column: t = max(floor, max over the dry columns OUTSIDE the pit within T.margin of
 *             (their ground - the Chebyshev distance)), never above the column's own ground -- a bowl with 1:1 banks down from the
 *             land round it and a flat floor: no step into the pit, nor between two pit columns, is more than 1 (an upper envelope
 *             of slope-1 cones is itself slope 1), so it is walkable and a designed shape (`steps2` counts any 2-step it adds).
 *   CELLS     every block above its column's target (y in t+1..g) that is ground a pit may take; `e` 1 for earth (the yield), `h` the
 *             half (W/E of the centre: one builder each). A column with a liquid or a built block in that span is held whole, and so
 *             is a leftover lid over a cave reaching below the bowl (`cave_under`). Leaves lying on the ground and runs of up to
 *             T.perchMax blocks hanging over air above it are listed too (`p` for the hanging ones: dug from an open top over air).
 *   LAYERS    the cells by height, top down: the order of the dig (pitDigNow).
 * `ok` false: the outline is not wholly read (`unread`), or no column is left to dig.
 */
export function pitPlan (read, site, T = PIT) {
  const outline = coveOutline(site)
  const xs = [...outline].map(k => Number(k.split(',')[0])), zs = [...outline].map(k => Number(k.split(',')[1]))
  const x0 = Math.min(...xs) - T.margin, x1 = Math.max(...xs) + T.margin, z0 = Math.min(...zs) - T.margin, z1 = Math.max(...zs) + T.margin
  const col = new Map(), water = []
  let unread = 0
  for (let z = z0; z <= z1; z++) {
    for (let x = x0; x <= x1; x++) {
      const c = columnOf(read, x, z, site.floor, T)
      col.set(`${x},${z}`, c)
      if (c.unread) { if (outline.has(`${x},${z}`)) unread++; continue }
      if (c.wet != null) water.push([x, z])
    }
  }
  const base = { site, outline: [...outline], box: [x0, z0, x1, z1], unread, water: water.length }
  if (unread) return { ok: false, why: 'unread', ...base }
  const rim = [], held = []
  const near = (x, z) => water.find(([wx, wz]) => cheb(x, z, wx, wz) <= T.rim)
  let pit = new Set()
  for (const k of outline) {
    const [x, z] = k.split(',').map(Number), c = col.get(k)
    const w = near(x, z)
    if (w) { rim.push([x, z, `water:${w[0]},${w[1]}`]); continue }
    if (c.trunk) { held.push([x, z, 'trunk']); continue }
    pit.add(k)
  }
  pit = largestPiece(smooth(pit))
  // the target: a bowl from the LAND round it (every dry column outside the pit, the rim included; the water lies beyond the rim)
  const outside = [...col.entries()].filter(([k, c]) => !pit.has(k) && !c.unread && c.wet == null && Number.isFinite(c.g)).map(([k, c]) => { const [x, z] = k.split(',').map(Number); return [x, z, c.g] })
  const cols = [], cells = []
  const byY = new Map()
  for (const k of pit) {
    const [x, z] = k.split(',').map(Number), c = col.get(k)
    let bank = -Infinity
    for (const [ox, oz, og] of outside) { const d = cheb(x, z, ox, oz); if (d <= T.margin) bank = Math.max(bank, og - d) }
    const bowl = Math.max(site.floor, Number.isFinite(bank) ? bank : site.floor), t = Math.min(c.g, bowl)
    // a leftover LID over a cave that goes below the bowl (its ground under the air is lower than the design): taking the lid would
    // open a hole in the floor -- the column is held whole (the finish fills under it)
    if (c.g < bowl && (c.perched ?? []).length) { held.push([x, z, 'cave_under']); continue }
    const mine = (c.perched ?? []).filter(y => isDiggable(read(x, y, z))).map(y => ({ at: [x, y, z], e: isEarth(read(x, y, z)) ? 1 : 0, h: x < site.cx ? 'W' : 'E', name: nm(read(x, y, z)), p: 1 }))
    // leaves lying ON the ground (a felled canopy) come off with it: dug first, top down (left, they would hang over the bowl)
    for (let y = c.g + 1; y <= c.g + 6 && /_leaves$/.test(nm(read(x, y, z))); y++) mine.push({ at: [x, y, z], e: 0, h: x < site.cx ? 'W' : 'E', name: nm(read(x, y, z)) })
    let why = null
    for (let y = c.g; y > t; y--) {
      const b = read(x, y, z)
      if (!b) { why = 'unread'; break }
      if (isLiquidish(b)) { why = 'liquid'; break }
      if (isSoft(b)) continue                        // a pocket of air inside the column: nothing to dig there
      if (!isDiggable(b)) { why = `built:${nm(b)}`; break }
      mine.push({ at: [x, y, z], e: isEarth(b) ? 1 : 0, h: x < site.cx ? 'W' : 'E', name: nm(b) })
    }
    if (why) { held.push([x, z, why]); continue }
    cols.push({ x, z, g: c.g, t })
    for (const m of mine) { cells.push(m); const L = byY.get(m.at[1]) ?? { y: m.at[1], n: 0, dirt: 0 }; L.n++; L.dirt += m.e; byY.set(m.at[1], L) }
  }
  // the design check: neighbours (8) of the finished surface -- pit and the ground round it -- that differ by 2 or more and did not before
  const fin = new Map(cols.map(c => [`${c.x},${c.z}`, c.t]))
  const g0 = k => { const c = col.get(k); return c && !c.unread ? (c.wet ?? c.g) : null }
  let steps2 = 0
  for (const c of cols) {
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      if (!dx && !dz) continue
      const k = `${c.x + dx},${c.z + dz}`, after = fin.has(k) ? fin.get(k) : g0(k)
      if (after == null) continue
      const before = g0(k), here0 = c.g
      if (Math.abs(after - c.t) >= 2 && !(before != null && Math.abs(before - here0) >= 2)) steps2++
    }
  }
  const layers = [...byY.values()].sort((p, q) => q.y - p.y)
  const dirt = cells.reduce((s, c) => s + c.e, 0)
  if (!cells.length) return { ok: false, why: 'nothing_to_dig', ...base, rim, held, pit: [...pit], cols, cells, layers, dirt, other: 0, steps2 }
  return { ok: true, ...base, rim, held, pit: [...pit], cols, cells, layers, dirt, other: cells.length - dirt, steps2 }
}

// ---- THE RECORD -------------------------------------------------------------------------------------------------------------
/**
 * THE RECORD of a plan -> the project's first (and only working) generation. Pure. `clear` lists every dig cell as a `cut` (its name
 * at the plan, its height `l`, earth `e`, half `h`): the showcase's read judges every dig against the head's clear list. No cells to
 * place (the pond finish is a later generation). `zones`: the outline and its rim, every height (nothing else is sited there).
 */
export function pitRecord (plan, { home = null, now = Date.now(), by = null } = {}) {
  const xs = plan.outline.map(k => Number(k.split(',')[0])), zs = plan.outline.map(k => Number(k.split(',')[1]))
  const box = [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)]
  const s = plan.site
  return {
    v: 1, blueprint: PIT_BLUEPRINT, plot: PIT_PLOT, home, state: 'open', builders_max: PIT_BUILDERS,
    site: { ...s }, box, floor: s.floor, s: s.floor,
    zones: [{ box: [box[0] - PIT.rim, -64, box[1] - PIT.rim, box[2] + PIT.rim, 320, box[3] + PIT.rim], why: `project:${PIT_PLOT}` }],
    cells: [], segments: [], replant: [],
    clear: plan.cells.map(c => ({ at: c.at, kind: 'cut', name: c.name, l: c.at[1], e: c.e, h: c.h, ...(c.p ? { p: 1 } : {}) })),
    cols: plan.cols.map(c => [c.x, c.z, c.g, c.t]),
    rim: plan.rim.map(r => [r[0], r[1]]), held: plan.held.map(h => [h[0], h[1], h[2]]),
    yield: { dirt: plan.dirt, other: plan.other, layers: plan.layers.map(L => [L.y, L.n, L.dirt]) },
    sitedAt: now, by,
  }
}

// ---- THE GUARD (live) -------------------------------------------------------------------------------------------------------
/**
 * THE SEA-BREACH GUARD -> null (dig) | { why, at }. Pure over `read`, re-read at the dig. A cell is never dug when:
 *   'water' / 'lava'  any water, ice, water plant, waterlogged block or lava within T.rim columns of it, from T.guardDown below to
 *                     T.guardUp above (the plan's rim holds by construction; this holds whatever the world did since);
 *   'unread'          any of those cells unread (fail closed: the visit's walk brings the bot near);
 *   'floor_open'      the block under it is not solid (a cave under the floor: digging it would open the bowl into it) -- except a
 *                     PERCHED block's air (`perched`: the plan listed it over air; taking it closes nothing);
 *   'covered'         the block above it is solid ground (top down: a cell is dug only from an open top); leaves above are no
 *                     cover (the layer gate takes a listed leaf first; one set aside unreached hangs, as the canopies round it do).
 * REMEDY (every refusal): the cell is SET ASIDE -- it stays as ground, part of the solid rim, and the dig goes on round it (the
 * layer gate passes over it, pitDigNow); the pond finish decides it by hand (docs/reports/pit/finish-plan.md). Nothing waits on it.
 */
export function pitGuard (read, at, T = PIT, { perched = false } = {}) {
  const [x, y, z] = at
  for (let dy = -T.guardDown; dy <= T.guardUp; dy++) {
    for (let dx = -T.rim; dx <= T.rim; dx++) {
      for (let dz = -T.rim; dz <= T.rim; dz++) {
        const b = read(x + dx, y + dy, z + dz)
        if (!b) return { why: 'unread', at: [x + dx, y + dy, z + dz] }
        if (isLiquidish(b)) return { why: /lava/.test(nm(b)) ? 'lava' : 'water', at: [x + dx, y + dy, z + dz] }
      }
    }
  }
  const below = read(x, y - 1, z), above = read(x, y + 1, z)
  if (!below || (below.boundingBox !== 'block' && !(perched && isSoft(below)))) return { why: 'floor_open', at: [x, y - 1, z] }
  if (above && above.boundingBox === 'block' && !/_leaves$/.test(nm(above))) return { why: 'covered', at: [x, y + 1, z] }
  return null
}

/** A listed cell still standing (its ground there to dig) -> bool. Pure. */
export const standing = (read, c) => { const b = read(...c.at); return !!b && isDiggable(b) }
/**
 * WHAT THE DIG MAY TAKE NOW -> { phase: 'dig' | 'done' | 'unread', y, half, cells: [{ at, kind, name, l, e, h }], held: [{ at, why,
 * w }], left, dirtLeft, byHalf }. Pure over `read`.
 *   THE LAYER GATE (top down, the walking rule): the dig works ONE height at a time -- the highest y with a standing cell the guard
 *   lets through. A cell the guard refuses is set aside (`held`, with its reason) and never holds the layers below: the bowl's every
 *   stage is the ground with its top layer shaved, so no step is ever more than the ground's own plus 1.
 *   A cell the record sets ASIDE (`rec.aside`, pitMissed: PIT.missMax visits found no stand for it) is held too (`unreached`).
 *   `half` (W/E): a builder's half first; none of its own at this height: the other half's (the caller's lease decides who works it).
 * `unread`: a listed cell not read (the bot is not at the pit). `done`: nothing standing that the guard lets through.
 */
export function pitDigNow (read, rec, { half = null, T = PIT } = {}) {
  const out = { phase: 'unread', y: null, half: null, cells: [], held: [], left: 0, dirtLeft: 0, byHalf: {} }
  const live = []
  for (const c of rec?.clear ?? []) {
    const b = read(...c.at)
    if (!b) return out
    if (!isDiggable(b)) continue
    out.left++; out.dirtLeft += c.e ? 1 : 0
    live.push({ c, b })
  }
  live.sort((p, q) => q.c.at[1] - p.c.at[1])
  const aside = new Set(rec?.aside ?? [])
  for (const { c, b } of live) {
    if (aside.has(c.at.join(','))) { out.held.push({ at: c.at, why: 'unreached', w: c.at }); continue }
    const g = pitGuard(read, c.at, T, { perched: !!c.p })
    if (g && g.why !== 'covered') { out.held.push({ at: c.at, why: g.why, w: g.at }); continue }
    if (g) continue                                   // covered: a cell above it comes first (it is in a higher layer)
    if (out.y == null) out.y = c.at[1]
    if (c.at[1] !== out.y) break
    out.byHalf[c.h] = (out.byHalf[c.h] ?? 0) + 1
    out.cells.push({ at: c.at, kind: 'cut', name: nm(b), l: c.l, e: c.e, h: c.h, ...(c.p ? { p: 1 } : {}) })
  }
  out.phase = out.cells.length ? 'dig' : 'done'
  if (half && out.cells.length) {
    const mine = out.cells.filter(c => c.h === half)
    out.half = mine.length ? half : PIT_HALVES.find(h => h !== half)
    out.cells = mine.length ? mine : out.cells.filter(c => c.h === out.half)
  }
  return out
}
/**
 * A VISIT THAT DUG NOTHING OF ITS LAYER -> the next record | null. Pure. `keys` the layer's cells still standing after the visit (the
 * view's); each one's miss count goes up, and at T.missMax it is SET ASIDE (`aside`): the layer gate passes over it from then on, so a
 * cell no stand reaches (a leaf too high, a block walled in) never holds the pit -- the remedy for "no stand" is the set-aside, taken
 * here, and the pond finish takes what is left by hand. A visit that ended on a fence, an abort or the clock is no miss (the caller's).
 */
export function pitMissed (rec, keys = [], T = PIT) {
  if (!rec || rec.plot !== PIT_PLOT || !keys.length) return null
  const misses = { ...(rec.misses ?? {}) }, aside = new Set(rec.aside ?? [])
  for (const k of keys) { if (aside.has(k)) continue; misses[k] = (Number(misses[k]) || 0) + 1; if (misses[k] >= T.missMax) aside.add(k) }
  return { ...rec, misses, aside: [...aside] }
}
/** Did the visit miss its layer (nothing dug, and not stopped by a fence, an abort or the clock)? -> the cells' keys still standing. */
export function pitMissKeys (read, now, r) {
  if (!r || r.cleared > 0 || /^(fence|aborted|deadline)/.test(String(r.stop ?? ''))) return []
  return (now?.cells ?? []).filter(c => standing(read, c)).map(c => c.at.join(','))
}
/** The view runVisit works: no cells to place, the layer's cells as clears (their names as the world reads them NOW). Pure. */
export const pitView = (rec, now) => ({ ...rec, cells: [], segments: [], replant: [], clear: now.cells })
/** buildrun.mjs `clearPart` for a half: its own lease, its own cells. Pure. */
export const pitClearPart = h => ({ lease: `seg-clear-${h}`, has: c => c.h === h })
/** The clear's live check (buildrun.mjs `p.clearOk(clear, read)`: before the walk and again at the dig) -> bool. Pure. */
export const pitClearOk = (c, read, T = PIT) => pitGuard(read, c.at, T, { perched: !!c.p }) == null

// ---- THE DEMAND -------------------------------------------------------------------------------------------------------------
/**
 * IS THE TOWN SHORT OF DIRT FOR A NAMED CONSUMER? -> { dig, short, need, stock, consumer, why }. Pure.
 *   needs   { tidy, grade, warehouse }: each consumer's open dirt cells (fills the town draws dirt for), null when it could not be read
 *   stock   the town's dirt in containers the index knows (null: unread -> 0, the known part; never a guess upward)
 *   bag     dirt this bot carries above its keep (dug and not banked yet: it counts against the short)
 * dig only while need > stock + bag: the pit is a supply for those cells, never a stock of its own. Every consumer unread: no dig
 * (`demand_unread`); the remedy is the next visit's reading (the records and the index read again; nothing else waits on it).
 */
export function pitDemand ({ needs = {}, stock = null, bag = 0 } = {}) {
  const named = Object.entries(needs).filter(([, v]) => Number.isFinite(v) && v >= 0)
  if (!named.length) return { dig: false, short: 0, chest: 0, need: null, stock, consumer: null, why: 'demand_unread' }
  const need = named.reduce((s, [, v]) => s + v, 0)
  const inTown = Number.isFinite(stock) ? Math.max(0, stock) : 0
  const short = Math.max(0, need - inTown - Math.max(0, Number(bag) || 0))
  const top = named.filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])[0]
  // `chest`: what the town's CHESTS lack (the bag not counted): while it is above 0 a bag's dug dirt is owed to them -- the pit stays
  // offered for the BANK even when the bag already covers the dig (Codex r3 BLOCKER: the carried surplus hid the pit, nothing banked)
  return { dig: short > 0, short, chest: Math.max(0, need - inTown), need, stock: Number.isFinite(stock) ? stock : null, consumer: top ? top[0] : null, why: short > 0 ? 'short' : need > 0 ? 'stocked' : 'no_need' }
}
/** Is the pit wanted now (the order's state) -> bool. Pure: a dig the town is short of, or a bank the chests are short of and this bag
 *  holds -- ANY dirt above the keep (`final`: Codex r4, a 24 surplus under bankMin stayed stranded); `bagDirt` its whole dirt count. */
export const pitWanted = (dem, bagDirt = 0, T = PIT) => !!dem && (dem.dig || ((dem.chest ?? 0) > 0 && pitBankDue(bagDirt, { final: true, T }) > 0))
/** How many cells one visit may dig -> n. Pure: never past what the town is short of, never past the visit's bound. */
export const pitDigCap = (short, T = PIT) => Math.max(0, Math.min(T.visitMax, Math.ceil(Number(short) || 0)))
/**
 * THE TIDY'S EARTH FILLS DRAW THE TOWN'S DIRT FIRST (the pit's dirt is for them) -> { dirt, cobblestone }. Pure. `want` the fills the
 * visit bills (tidy.mjs fillWant), `townDirt` the dirt the index shows in the town's containers. Without town dirt: cobblestone, as before.
 */
export function pitFillSplit (want = 0, townDirt = 0) {
  const w = Math.max(0, Number(want) || 0), d = Math.max(0, Math.min(w, Number(townDirt) || 0))
  return { dirt: d, cobblestone: w - d }
}

// ---- THE BANK ---------------------------------------------------------------------------------------------------------------
/**
 * WHERE THE DUG DIRT GOES -> [key] in order (at most `max`). Pure. The places the town's draws search (matsWithdraw: the town index):
 *   1. the storehouse's DIRT column (warehouse.mjs: the column layout, when it is on) -- its chests with room;
 *   2. town containers the index knows that already hold dirt and have room (a draw then finds it in one place);
 *   3. any other known town container with a free slot.
 * Nearest to `from` first within each tier; never a container the caller marks full or failed (`skip`).
 *   cands  [{ k, pos: [x, y, z], dirt, dirtRoom, free, column, room }] (`dirtRoom`: room on its partial dirt stacks: a full chest still
 *          takes dirt onto them -- bankInto merges, rig run 1: every chest that held dirt read full and the bank found none)
 */
export function pitBankOrder (cands = [], { from = [0, 0, 0], skip = new Set(), max = 3 } = {}) {
  const d = c => Math.hypot(c.pos[0] - from[0], c.pos[2] - from[2])
  const ok = (cands ?? []).filter(c => c && Array.isArray(c.pos) && !skip.has(c.k) && (c.free > 0 || (c.column && c.room > 0) || (c.dirt > 0 && c.dirtRoom > 0)))
  const tier = c => (c.column ? 0 : c.dirt > 0 ? 1 : 2)
  return ok.sort((a, b) => tier(a) - tier(b) || d(a) - d(b)).slice(0, max).map(c => c.k)
}
/** How much dirt a visit banks now -> n (0: not yet). Pure. Above the bag's keep; at least T.bankMin unless `final` (the visit ends). */
export function pitBankDue (bagDirt = 0, { final = false, T = PIT } = {}) {
  const above = Math.max(0, (Number(bagDirt) || 0) - T.keep)
  return above >= T.bankMin || (final && above > 0) ? above : 0
}

/**
 * THE BANK'S CLICKS for one container -> [{ slot, name, count, from?, half? }] (skills.mjs bankInto's steps). Pure. Up to `n` dirt above
 * the bag's `keep`: whole stacks first (largest that fits), then HALVES of what is left (a right click takes ceil(count / 2); a stack
 * can be halved again) -- so a single 48-stack with a 16 keep still banks (Codex r1 BLOCKER: whole stacks alone banked nothing, the
 * carried surplus then read as supply and the pit stopped). Never below the keep.
 */
export function pitBankSteps (bag = [], n = 0, keep = PIT.keep) {
  const dirt = (bag ?? []).filter(it => it?.name === 'dirt' && (it.count ?? 0) > 0).map(it => ({ slot: it.slot, cur: it.count })).sort((a, b) => b.cur - a.cur || a.slot - b.slot)
  const total = dirt.reduce((t, it) => t + it.cur, 0)
  let left = Math.max(0, Math.min(Math.floor(Number(n) || 0), total - Math.max(0, Number(keep) || 0)))
  const out = []
  for (const it of dirt) if (it.cur <= left) { out.push({ slot: it.slot, name: 'dirt', count: it.cur }); left -= it.cur; it.cur = 0 }
  for (const it of dirt) {
    while (it.cur > 1 && Math.ceil(it.cur / 2) <= left) { const take = Math.ceil(it.cur / 2); out.push({ slot: it.slot, name: 'dirt', count: take, from: it.cur, half: true }); left -= take; it.cur -= take }
  }
  return out
}

// ---- ROWS -------------------------------------------------------------------------------------------------------------------
/** `_pit` rows' detail: op = dig | bank | guard | demand | sited | walk | done | mode. Pure. */
export const pitDetail = (op, d = {}) => `op=${op} ` + ['y', 'half', 'n', 'dirt', 'short', 'consumer', 'to', 'at', 'why', 'gen'].map(k => `${k}=${d[k] == null ? '-' : Array.isArray(d[k]) ? d[k].join(',') : String(d[k]).replace(/\s+/g, '_').slice(0, 120)}`).join(' ')
/** The licence row (once per spawn). Pure. */
export const pitModeDetail = (site = PITSITE.site) => (site ? `op=mode on=1 site=${site.cx},${site.cz},${site.w},${site.l} floor=${site.floor} rim=${PIT.rim} builders=${PIT_BUILDERS}` : 'op=mode on=0')
