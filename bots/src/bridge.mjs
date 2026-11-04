// BRIDGEPOST-01 (A): COBBLE BRIDGES OVER THE WATER EXPEDITIONS CANNOT SWIM (owner 11-01 "water/boats/bridges OK"; 11-03 "design all
// ... implement and deploy where you feel is right"; docs/reports/bridgepost-design-2026-11-03.md).
//
// PURE: the span (where a bridge can go), the site from a refused crossing, the build plan (every block in order, with the cell the
// builder stands on and the block and face it clicks), the next step read from the WORLD (progress is never stored: a half-built
// bridge resumes from what stands), the builder loop over an injected actuator (skills.mjs wires the bot; sandbox/bridge drives bare
// mineflayer with the SAME loop), the site index's merge, and the reservation the tidy keeps off. Nothing here touches a bot or a file.
//
// THE SHAPE (axis-aligned: a diagonal deck has corner-only joins a walker cannot cross):
//   deck   3 wide, AT the water's surface block (y = wy): the walkway's stand is wy + 1, level with a level shore (stand = water + 1),
//          so walking onto it is walking on land -- no step, no ramp, and the expedition's own surface read sees dry ground
//   rails  1 high on the two outer deck columns (y = wy + 1), over every water row: the walkway between them is 1 wide and walled,
//          so a walker cannot step off sideways (owner 11-03: "rails/edges so bots do not fall in")
//   ends   the shores themselves: a stand at wy + 1 or wy + 2 (one step up, walkable) on both sides; a higher bank is refused here
//          (the stair abutment is a later piece) and logged
//   light  a torch on a rail every TORCH_EVERY rows, only where no ice is near (a lit cell melts ice: a hole in a frozen lake's road)
// THE BUILD (each block placed from the deck already built -- never "over water from water"):
//   row i's centre deck is clicked onto the +axis face of row i-1's centre (row 0: the near shore's ground block), standing on row i-1;
//   its two side decks onto the centre's side faces; its two rails onto the side decks' tops; only then does the builder step onto
//   row i. So the cell it stands on always has both rails beside it and the water is only ever ahead.
// A FINISHED BRIDGE is used by legTarget (expedition.mjs `bridges`): a leg to its near end, then one along the deck to past its far
// end; its far end is a GATE like a swim's far shore, so the way home walks back over it.

export const BRIDGE_MAX = 32                 // wet columns (owner item: 17-32; expwater swims <= 16 onto level shores)
export const BRIDGE_MIN = 1                  // a narrow crossing behind a bank the swim refused is bridged too
export const BANK_MAX = 2                    // a shore's stand at most wy + this (one step up from the deck's stand at wy + 1)
export const LAND_INLAND = 3                 // the far shore must be dry and standable this far past its first column
export const BEYOND_MIN = 30                 // a site's landing must let the trip's planner go on at least this far (two legs ~ 40)
export const SITE_R = 20                     // a refused crossing is sited within this of where the bot turned
export const SITE_SEEN = 2                   // a site is built once this many DISTINCT trips were refused there (owner: sited from logged crossings)
export const SITE_MERGE_R = 8                // two sightings on the same axis within this (near ends) are one site
export const BRIDGE_USE_R = 28               // a finished bridge's near end within this (x/z) of a leg's start is walked to (CRUMB_HOP_MAX)
export const TORCH_EVERY = 8
export const BUILD_FAILS_MAX = 2             // a step that failed this often in one visit ends the visit (the next trip reads the world again)
export const BRIDGE_CARRY = 192              // cobblestone a bridge trip carries at most (3 stacks: a 32-wide bridge is ~160)

const OFF = ['off', '0', 'false', 'no']
/** THE SWITCH -> bool. EXPEDITION_BRIDGE=off: no siting, no building, no bridge legs. Unset: on (expeditions themselves are pooled). */
export const bridgeOn = (env = process.env) => !OFF.includes(String(env?.EXPEDITION_BRIDGE ?? '').trim().toLowerCase())

const nm = b => String(b?.name ?? '').replace(/\[.*\]$/, '')
const solid = b => !!b && b.boundingBox === 'block'
const wl = b => b?.waterlogged === true || /\[waterlogged\]$/.test(String(b?.name ?? ''))
const isWater = b => !!b && nm(b) === 'water' && !wl(b)
const ICE = /^(ice|frosted_ice)$/
const SEAGRASS = /^(seagrass|tall_seagrass)$/                   // replaceable: a placement into it works
const HAZARD = /^(lava|bubble_column|magma_block|soul_sand)$/    // never under or in a deck
const FALLING = /^(sand|red_sand|gravel|suspicious_sand|suspicious_gravel|.*concrete_powder)$/
const AIRISH = b => !!b && /^(air|cave_air|void_air)$/.test(nm(b))
const passable = b => !!b && !solid(b) && !isWater(b) && !wl(b) && !/^(lava|bubble_column|kelp|kelp_plant|seagrass|tall_seagrass)$/.test(nm(b))
/** Is the cell a DONE deck/rail block: solid, not falling (it drops into the water)? Pure. ICE counts (the showcase's lakes are
 *  frozen at their edges: the near shore is often an ice sheet): ice melts only by BLOCK light above 11, never by the sun, so no torch
 *  goes within ICE_TORCH_R of it (expedition.mjs torchSafe) and it stands. */
export const blockDone = b => solid(b) && !FALLING.test(nm(b))
/** May a block be clicked INTO the cell: water (a source or flowing: vanilla replaces it), air, seagrass? Pure. */
export const placeableInto = b => !!b && !wl(b) && (isWater(b) || AIRISH(b) || SEAGRASS.test(nm(b)))
const standable = (read, x, y, z) => { const g = read(x, y - 1, z); return solid(g) && !FALLING.test(nm(g)) && !wl(g) && passable(read(x, y, z)) && passable(read(x, y + 1, z)) }
const zoneIn = (zones, x, z, m) => {
  for (const q of zones ?? []) {
    const b = Array.isArray(q?.box) ? q.box : [q?.x0, q?.y0, q?.z0, q?.x1, q?.y1, q?.z1]
    if (!b.every(Number.isFinite)) continue
    if (x >= b[0] - m && x <= b[3] + m && z >= b[2] - m && z <= b[5] + m) return String(q.id ?? 'zone')
  }
  return null
}
const AXES = Object.freeze([[1, 0], [-1, 0], [0, 1], [0, -1]])

/**
 * THE SPAN from a near-shore stand cell along an axis -> { ok, near, far, land, axis, wy, w, rows } | { ok: false, why }. Pure.
 * `near` [x, y, z] a standable dry cell whose next column along `axis` [ax, az] is water. The run: w columns whose surface is a WATER
 * block at one height wy (the first wet column's), each with its two side columns at wy water/air/seagrass/solid-not-ice and the
 * walkway's two cells above (wy + 1, wy + 2) and the rails' cells (wy + 1) passable or already solid; never lava, a bubble column, ice
 * or a protected zone (+ margin). Then the far shore: its first column standable at wy + 1 .. wy + BANK_MAX, and LAND_INLAND dry
 * standable columns past it. The near stand must be wy + 1 .. wy + BANK_MAX too (and its ground block, or the one under it, solid:
 * row 0's reference).
 */
export function bridgeSpan (read, near, axis, { max = BRIDGE_MAX, zones = [], margin = 4 } = {}) {
  const [ax, az] = axis, lx = -az, lz = ax          // lateral (left) of the axis
  const [x0, y0, z0] = near
  if (!standable(read, x0, y0, z0)) return { ok: false, why: 'near_unstandable' }
  // the first wet column: its surface (the topmost water block under the walk's height)
  let wy = null
  for (let y = y0; y >= y0 - 12; y--) { const b = read(x0 + ax, y, z0 + az); if (b == null) return { ok: false, why: 'unread' }; if (isWater(b)) { wy = y; break } if (solid(b)) break }
  if (wy == null) return { ok: false, why: 'no_water' }
  if (isWater(read(x0 + ax, wy + 1, z0 + az))) return { ok: false, why: 'deep_surface' }
  const up = y0 - wy
  if (up < 1) return { ok: false, why: 'near_wet' }
  if (up > BANK_MAX) return { ok: false, why: 'bank_high', bank: up }
  // row 0's reference: the near column's block at wy (the stand's own ground when up == 1)
  if (!blockDone(read(x0, wy, z0))) return { ok: false, why: 'no_ref' }
  const rows = []
  for (let i = 1; i <= max + 1; i++) {
    const x = x0 + ax * i, z = z0 + az * i
    const c = read(x, wy, z)
    if (c == null) return { ok: false, why: 'unread' }
    const zid = zoneIn(zones, x, z, margin) ?? zoneIn(zones, x + lx, z + lz, margin) ?? zoneIn(zones, x - lx, z - lz, margin)
    if (zid) return { ok: false, why: 'zone', zone: zid }
    if (isWater(c)) {
      if (i > max) return { ok: false, why: 'wide', w: i }
      // a water surface over air is a falling sheet, not a lake
      if (AIRISH(read(x, wy - 1, z))) return { ok: false, why: 'not_lake' }
      const cells = []
      for (const s of [-1, 1]) {
        const sx = x + lx * s, sz = z + lz * s
        const sb = read(sx, wy, sz)
        if (sb == null) return { ok: false, why: 'unread' }
        if (HAZARD.test(nm(sb)) || (!placeableInto(sb) && !blockDone(sb))) return { ok: false, why: `side_${nm(sb)}` }
        const rb = read(sx, wy + 1, sz)
        if (rb == null) return { ok: false, why: 'unread' }
        if ((!placeableInto(rb) && !blockDone(rb)) || isWater(rb)) return { ok: false, why: `rail_${nm(rb)}` }
        cells.push({ side: s, deck: [sx, wy, sz], rail: [sx, wy + 1, sz] })
      }
      for (const dy of [1, 2]) { const h = read(x, wy + dy, z); if (h == null) return { ok: false, why: 'unread' }; if (!passable(h)) return { ok: false, why: `headroom_${nm(h)}` } }
      for (const dy of [-1, -2]) { const u = read(x, wy + dy, z); if (u && HAZARD.test(nm(u))) return { ok: false, why: `under_${nm(u)}` } }
      rows.push({ i: i - 1, centre: [x, wy, z], sides: cells })
      continue
    }
    // out of the water: the far shore
    if (!rows.length) return { ok: false, why: 'no_water' }
    if (HAZARD.test(nm(c))) return { ok: false, why: `far_${nm(c)}` }
    let fy = null
    for (let y = wy + 1; y <= wy + BANK_MAX; y++) if (standable(read, x, y, z)) { fy = y; break }
    if (fy == null) return { ok: false, why: 'far_bank', bank: (() => { for (let y = wy + 1; y <= wy + 8; y++) if (standable(read, x, y, z)) return y - wy; return 'none' })() }
    let ly = fy
    for (let k = 1; k <= LAND_INLAND; k++) {
      const qx = x + ax * k, qz = z + az * k
      let s = null
      for (const dy of [0, 1, -1]) if (standable(read, qx, ly + dy, qz)) { s = ly + dy; break }
      if (s == null) return { ok: false, why: 'far_narrow' }
      ly = s
    }
    return { ok: true, near: [x0, y0, z0], far: [x, fy, z], land: [x + ax * LAND_INLAND, ly, z + az * LAND_INLAND], axis: [ax, az], wy, w: rows.length, rows }
  }
  return { ok: false, why: 'wide', w: max + 1 }
}

/**
 * THE SITE at a refused crossing -> { ok, span, bearing, key } | { ok: false, why, tried }. Pure. Every standable cell within `r` of
 * `pos` whose next column along an axis is water, every axis that goes OUTWARD on the trip's bearing (its dot with the bearing >= 0.3,
 * and the far end further from home than the near end by at least half the width); the narrowest span wins (ties: the nearer to the
 * bot, then the axis order). The refusal kinds are counted for the log.
 */
export function bridgeSite (read, pos, { home, bearingV, r = SITE_R, zones = [], max = BRIDGE_MAX, beyond = null, reach = null } = {}) {
  const tried = {}
  let best = null
  const px = Math.floor(pos.x), pz = Math.floor(pos.z), py = Math.floor(pos.y)
  const dHome = (x, z) => Math.hypot(x - home.x, z - home.z)
  for (let ox = -r; ox <= r; ox++) for (let oz = -r; oz <= r; oz++) {
    if (ox * ox + oz * oz > r * r) continue
    const x = px + ox, z = pz + oz
    for (let y = py + 6; y >= py - 6; y--) {
      if (!standable(read, x, y, z)) continue
      for (const axis of AXES) {
        if (bearingV && axis[0] * bearingV.dx + axis[1] * bearingV.dz < 0.3) continue
        const n1 = read(x + axis[0], y - 1, z + axis[1]), n2 = read(x + axis[0], y - 2, z + axis[1]), n3 = read(x + axis[0], y - 3, z + axis[1])
        if (!isWater(n1) && !isWater(n2) && !isWater(n3)) continue
        const s = bridgeSpan(read, [x, y, z], axis, { max, zones })
        if (!s.ok) { tried[s.why] = (tried[s.why] ?? 0) + 1; continue }
        if (dHome(s.far[0], s.far[2]) - dHome(x, z) < s.w / 2) { tried.inward = (tried.inward ?? 0) + 1; continue }
        // A BRIDGE MUST OPEN THE WAY (offline 11-03: the narrowest spans by the b3 and b5 turns were 1-wide gaps between two ice
        // sheets with more water behind): `beyond(span)` -> how far the trip's own planner gets past the span's landing (blocks of
        // distance from home gained), and a span that opens less than BEYOND_MIN is no site
        // ...and its near end must be one the bot walks to DRY from where it turned (offline 11-03 b3: a near end on an ice sheet across
        // a strip of open water from the bot was sited and never reached)
        if (reach && !reach(s.near)) { tried.unreached = (tried.unreached ?? 0) + 1; continue }
        const g = beyond ? Number(beyond(s)) || 0 : BEYOND_MIN
        if (g < BEYOND_MIN) { tried.dead_end = (tried.dead_end ?? 0) + 1; continue }
        const d = Math.hypot(ox, oz)
        if (!best || s.w < best.s.w || (s.w === best.s.w && (g > best.g || (g === best.g && d < best.d)))) best = { s, d, g }
      }
      break   // one stand per column (the topmost)
    }
  }
  if (!best) return { ok: false, why: 'no_span', tried }
  return { ok: true, span: best.s, key: siteKey(best.s), gain: best.g, tried }
}
/** A span's identity: its near stand and axis. Pure. */
export const siteKey = s => `${s.near.join(',')}:${s.axis.join(',')}`

/**
 * THE BUILD PLAN of a span -> [{ cell, kind: 'deck'|'side'|'rail'|'torch', stand, ref, face, item, row }] in order. Pure. Row i (0 at
 * the near shore): its centre deck (ref: the previous row's centre, or the near column's ground at wy, face +axis), its two sides (ref:
 * this row's centre, face +-lateral), its two rails (ref: the side below, face up), and on every TORCH_EVERY-th row a torch on the left
 * rail (ref: the rail, face up). Every step of row i is clicked STANDING on the previous row's centre (row 0: the near stand). A cell
 * already solid in the world is still listed (bridgeNext skips it).
 */
export function bridgePlan (span, { torches = true } = {}) {
  const [ax, az] = span.axis, lx = -az, lz = ax
  const wy = span.wy
  const out = []
  for (const row of span.rows) {
    const i = row.i
    const [cx, , cz] = row.centre
    const stand = i === 0 ? [...span.near] : [cx - ax, wy + 1, cz - az]
    const prev = [cx - ax, wy, cz - az]
    out.push({ cell: [cx, wy, cz], kind: 'deck', stand, ref: prev, face: [ax, 0, az], item: 'cobblestone', row: i })
    for (const s of [-1, 1]) out.push({ cell: [cx + lx * s, wy, cz + lz * s], kind: 'side', stand, ref: [cx, wy, cz], face: [lx * s, 0, lz * s], item: 'cobblestone', row: i })
    for (const s of [-1, 1]) out.push({ cell: [cx + lx * s, wy + 1, cz + lz * s], kind: 'rail', stand, ref: [cx + lx * s, wy, cz + lz * s], face: [0, 1, 0], item: 'cobblestone', row: i })
    if (torches && i % TORCH_EVERY === 0) out.push({ cell: [cx + lx, wy + 2, cz + lz], kind: 'torch', stand, ref: [cx + lx, wy + 1, cz + lz], face: [0, 1, 0], item: 'torch', row: i })
  }
  return out
}
/** Blocks the plan still needs, by item (the cells not yet done in the world) -> { cobblestone, torch }. Pure. */
export function bridgeNeed (read, plan) {
  const out = { cobblestone: 0, torch: 0 }
  for (const s of plan) if (!stepDone(read, s)) out[s.item] = (out[s.item] ?? 0) + 1
  return out
}
/** Is a plan step done in the world? A torch step is done by a torch, or skipped for good when no torch can stand (not lit). Pure. */
export function stepDone (read, s) {
  const b = read(...s.cell)
  if (s.kind === 'torch') return /torch$/.test(nm(b)) || !AIRISH(b)
  return blockDone(b)
}
/**
 * THE NEXT STEP from the world -> { step, index } | { done: true } | { blocked: why, index }. Pure. The first step not done; its
 * reference must be done (the plan's order guarantees it once the steps before are), its cell clickable into. A torch step is
 * skipped (done) when `torchOk(step)` says no (ice near) or no torch is held (`haveTorch` false): the bridge is complete without it.
 */
export function bridgeNext (read, plan, { torchOk = () => true, haveTorch = true } = {}) {
  for (let k = 0; k < plan.length; k++) {
    const s = plan[k]
    if (stepDone(read, s)) continue
    if (s.kind === 'torch' && (!haveTorch || !torchOk(s))) continue
    const c = read(...s.cell)
    if (c == null) return { blocked: 'unread', index: k }
    if (!placeableInto(c)) return { blocked: `cell_${nm(c)}`, index: k }
    if (!blockDone(read(...s.ref))) return { blocked: 'no_ref', index: k }
    return { step: s, index: k }
  }
  return { done: true }
}
/** Is the bridge WALKABLE end to end: every deck, side and rail cell done, every walkway cell clear? Pure (the torch is decoration). */
export function bridgeIntact (read, plan) {
  for (const s of plan) {
    if (s.kind === 'torch') continue
    if (!blockDone(read(...s.cell))) return false
    if (s.kind === 'deck') { const [x, y, z] = s.cell; if (!passable(read(x, y + 1, z)) || !passable(read(x, y + 2, z))) return false }
  }
  return true
}

/**
 * THE BUILDER (one visit's share) over an actuator -> { stop, placed, steps, why }. The SAME loop runs in the bot (skills.mjs) and in
 * the Paper proof (sandbox/bridge/bridge.mjs).
 *   io.read(x, y, z)            the world as the client sees it
 *   io.feet() -> [x, y, z]      the cell the bot's feet are in
 *   io.walkTo([x, y, z])        walk to stand ON that cell (resolves; never throws for a refused walk)
 *   io.place(step) -> bool      hold step.item, click step.ref's step.face; resolves after the server's answer (or a timeout)
 *   io.inWater() -> bool, io.has(item) -> n, io.now() -> ms, io.aborted() -> bool, io.torchOk(step) -> bool, io.sleep(ms)
 * Stops: 'done' (bridgeNext says so), 'time' (until), 'wet' (the bot is in the water: it swims out; the next trip resumes), 'stand'
 * (it could not stand where the step needs it, twice), 'no_material', 'place_failed' (one step failed BUILD_FAILS_MAX times),
 * 'blocked:<why>' (the next cell cannot take a block), 'aborted'.
 */
export async function buildBridge (io, plan, { until = Infinity } = {}) {
  let placed = 0, steps = 0
  const fails = new Map()
  let standFails = 0
  for (;;) {
    if (io.aborted?.()) return { stop: 'aborted', placed, steps }
    if (io.now() >= until) return { stop: 'time', placed, steps }
    if (io.inWater()) return { stop: 'wet', placed, steps }
    const n = bridgeNext(io.read, plan, { torchOk: io.torchOk ?? (() => true), haveTorch: (io.has('torch') ?? 0) > 0 })
    if (n.done) return { stop: 'done', placed, steps }
    if (n.blocked) return { stop: `blocked:${n.blocked}`, placed, steps, index: n.index }
    const s = n.step
    steps++
    if ((io.has(s.item) ?? 0) < 1) return { stop: 'no_material', placed, steps, item: s.item }
    const f = io.feet()
    if (!(f[0] === s.stand[0] && f[2] === s.stand[2] && Math.abs(f[1] - s.stand[1]) <= 0)) {
      await io.walkTo(s.stand)
      const g = io.feet()
      if (io.inWater()) return { stop: 'wet', placed, steps }
      if (!(g[0] === s.stand[0] && g[2] === s.stand[2] && g[1] === s.stand[1])) {
        if (++standFails >= 2) return { stop: 'stand', placed, steps, at: g, want: s.stand }
        continue
      }
    }
    standFails = 0
    const ok = await io.place(s)
    if (ok && stepDone(io.read, s)) { placed++; continue }
    const k = s.cell.join(',')
    fails.set(k, (fails.get(k) ?? 0) + 1)
    if (fails.get(k) >= BUILD_FAILS_MAX) return { stop: 'place_failed', placed, steps, cell: s.cell, kind: s.kind }
    await io.sleep?.(400)
  }
}

// ---- the site index (the town's `expedition-<home>.bridges.jsonl`: one line per sighting / state change) ----------------------------

/**
 * THE SITES from the index lines -> [{ key, id, span, bearing, seen: Set(trip ids), complete, failed: [t...], t }]. Pure. A `sight` line
 * adds its trip to the site whose axis matches and whose near end lies within SITE_MERGE_R (else a new site); a `state` line
 * (complete true/false, failed) updates the site by id.
 */
export function bridgeSites (lines = []) {
  const sites = []
  for (const l of lines) {
    if (l?.op === 'sight' && l.span?.near && l.span?.axis) {
      const s = sites.find(q => q.span.axis.join(',') === l.span.axis.join(',') && Math.hypot(q.span.near[0] - l.span.near[0], q.span.near[2] - l.span.near[2]) <= SITE_MERGE_R)
      if (s) { if (l.trip) s.seen.add(l.trip); s.t = Math.max(s.t, Number(l.t) || 0); continue }
      sites.push({ key: siteKey(l.span), id: l.id ?? siteKey(l.span), span: l.span, bearing: l.bearing ?? null, seen: new Set(l.trip ? [l.trip] : []), complete: false, failed: [], t: Number(l.t) || 0 })
    } else if (l?.op === 'state' && l.id) {
      const s = sites.find(q => q.id === l.id)
      if (!s) continue
      if (typeof l.complete === 'boolean') s.complete = l.complete
      if (l.failed) s.failed.push(Number(l.t) || 0)
    }
  }
  return sites
}
/** THE SITE TO BUILD NOW -> site | null. Pure. Not complete, seen by >= SITE_SEEN trips, fewer than 3 failed visits in 24 h; the most
 *  seen first, then the narrowest. */
export function bridgeToBuild (sites = [], now = 0) {
  return sites.filter(s => !s.complete && s.seen.size >= SITE_SEEN && s.failed.filter(t => now - t < 24 * 60 * 60_000).length < 3)
    .sort((a, b) => b.seen.size - a.seen.size || a.span.w - b.span.w)[0] ?? null
}
/** The finished bridges as legTarget's `bridges` -> [{ id, near, far, land, axis, w }]. Pure. */
export const bridgesDone = (sites = []) => sites.filter(s => s.complete).map(s => ({ id: s.id, near: s.span.near, far: s.span.far, land: s.span.land, axis: s.span.axis, w: s.span.w }))

/** Every bridge site's footprint (built or not) as reservations the tidy and the land plan keep off -> zones. Pure. */
export function bridgeZones (sites = [], m = 1) {
  const out = []
  for (const s of sites) {
    const pts = [s.span.near, s.span.far, ...s.span.rows.flatMap(r => r.sides.map(c => c.deck))]
    const xs = pts.map(p => p[0]), zs = pts.map(p => p[2])
    out.push({ box: [Math.min(...xs) - m, -64, Math.min(...zs) - m, Math.max(...xs) + m, 320, Math.max(...zs) + m], why: 'expedition:bridge' })
  }
  return out
}
/** Every planned block of every site ("x,y,z") -- the tidy's dig-time guard. Pure. */
export const bridgeCellKeys = (sites = []) => sites.flatMap(s => bridgePlan(s.span).map(p => p.cell.join(',')))

/** `_expedition op=bridge_*` details. Pure. */
export const spanDetail = s => `near=${s.near.join(',')} far=${s.far.join(',')} axis=${s.axis.join(',')} w=${s.w} wy=${s.wy} cost=${5 * s.w}`
