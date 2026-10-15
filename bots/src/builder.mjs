// THE GENERIC PLACEMENT BUILDER (ziggurat stage 3 = town projects stage 3: built ONCE, shared; docs/reports/
// ziggurat-mineshaft-2026-10-15.md 3.5 "plinth's planner over the frozen cells").
//
// WHAT IT IS. A structure is a FROZEN list of cells, each with what it wants (a block name or a predicate). The builder
// places them -- never digs -- one click at a time, from what the world says NOW (Baritone's BuilderProcess shape, as
// blueprint.mjs: progress is the re-observed world, never a saved index). A visit asks nextPlacement() for the first cell in
// the caller's order that can be placed now, walks to its stand, clicks, and believes only the server (the witness the
// caller injects). So an interrupted visit, a restart or a second bot resume from the same truth.
//
// WHERE THE RULES COME FROM. The walk probe, the stand search, the support faces, the line of sight and the after-click
// walk-back are plinth-01's (plinth.mjs, origin/plinth-on-8cd0bc6 fd86d351: Codex + Claude APPROVE, Paper 5/5), lifted
// here VERBATIM in behaviour and stripped of the well: plinth is not on this base. When plinth lands on a base that has
// this file, plinth.mjs imports these instead of keeping its copies (one rule set, one test suite).
//   - a click is a TOP face (eye above it) or a SIDE face of a solid, usable neighbour -- never a bottom face;
//   - the stand is walk-reachable from `start` (the town / the apron) BEFORE the click and walks back to it AFTER the
//     click: a placement never walls its builder in;
//   - BOTTOM-UP in every column: a cell is never placed over a cell of the list still open below it;
//   - a cell is never placed while a body (any other entity's box) touches it or the cell above it (design 3.3:
//     a bystander is never walled in; its cell waits until it moves).
// WHAT IS NOT HERE: who may build (leases, slots, the fence -- the caller's), the order (the caller's list order is the
// priority), and anything structure-specific (the monument's frontier barrier and cover rule are stage 4's, expressed as
// the list it hands in). Nothing here touches the world, the disk or mineflayer: the executor's effects are injected.

// ---- cells, reads --------------------------------------------------------------------------------------------------

/** A cell's key: one exact number (plinth.mjs cellKey; |x|,|z| < 2^20, -512 <= y < 512). */
export const bk = (x, y, z) => ((x + 1048576) * 2097152 + (z + 1048576)) * 1024 + (y + 512)
export const BUILD_REACH = 4.5
export const EYE_HEIGHT = 1.62
/** Placeable INTO (vanilla replaceable ground cover; never a liquid: nothing is built wet). */
export const BUILD_REPLACEABLE = new Set(['air', 'cave_air', 'void_air', 'short_grass', 'grass', 'fern', 'dead_bush', 'tall_grass', 'large_fern'])
const LIQUID = /^(water|lava|flowing_water|flowing_lava|bubble_column)$/
export const solid = b => !!b && b.boundingBox === 'block'
export const passable = b => !!b && b.boundingBox === 'empty' && !LIQUID.test(b.name ?? '')
export const replaceable = b => !!b && BUILD_REPLACEABLE.has(b.name)
const CARD = Object.freeze([[1, 0], [-1, 0], [0, 1], [0, -1]])
const FACES = Object.freeze([[0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]])   // ref offsets: below, then the sides
export const PLACED = Object.freeze({ name: 'cobblestone', boundingBox: 'block' })

/** An overlay on read(): `cells` (Map key -> block) wins. Pure. */
export function overlay (read, cells) {
  return (x, y, z) => { const k = bk(x, y, z); return cells.has(k) ? cells.get(k) : read(x, y, z) }
}
/** read() memoised for one plan (the world does not change while it is computed). */
export function memo (read) {
  const m = new Map()
  return (x, y, z) => { const k = bk(x, y, z); if (m.has(k)) return m.get(k); const v = read(x, y, z); m.set(k, v); return v }
}

// ---- walking (plinth.mjs standable / walkReach / walkReachBack) -------------------------------------------------------

/** Feet and head open (no liquid) over a solid floor. Pure. */
export function standable (read, x, y, z) {
  return passable(read(x, y, z)) && passable(read(x, y + 1, z)) && solid(read(x, y - 1, z))
}

const inBoxOf = box => (x, y, z) => !box || (x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1 && z >= box.z0 && z <= box.z1)

/**
 * EVERY FEET CELL REACHABLE ON FOOT FROM `start` -> Set of bk. Pure. Cardinal walk, step up 1 (head room over the origin),
 * drop 1..3; within `box`; never a `forbid` cell; no digging, placing, swimming or diagonals. Conservative: what it reaches
 * the pathfinder reaches; the converse is not claimed.
 */
export function walkReach (read, start, { box = null, forbid = () => false, maxNodes = 120_000, until = null } = {}) {
  const seen = new Set()
  if (!start || !standable(read, start.x, start.y, start.z)) return seen
  const inBox = inBoxOf(box)
  const ok = (x, y, z) => inBox(x, y, z) && !forbid(x, y, z) && standable(read, x, y, z)
  const q = [[start.x, start.y, start.z]]
  seen.add(bk(start.x, start.y, start.z))
  const push = (x, y, z) => { const k = bk(x, y, z); if (!seen.has(k)) { seen.add(k); q.push([x, y, z]) } }
  for (let i = 0; i < q.length && seen.size < maxNodes; i++) {
    if (until != null && seen.has(until)) break
    const [x, y, z] = q[i]
    for (const [dx, dz] of CARD) {
      const nx = x + dx, nz = z + dz
      if (ok(nx, y, nz)) { push(nx, y, nz); continue }
      if (solid(read(nx, y, nz)) && passable(read(x, y + 2, z)) && ok(nx, y + 1, nz)) { push(nx, y + 1, nz); continue }
      if (!inBox(nx, y, nz) || forbid(nx, y, nz) || !passable(read(nx, y, nz)) || !passable(read(nx, y + 1, nz))) continue
      for (let d = 1; d <= 3; d++) {
        const fy = y - d
        if (forbid(nx, fy, nz) || !passable(read(nx, fy, nz))) break
        if (solid(read(nx, fy - 1, nz))) { if (ok(nx, fy, nz)) push(nx, fy, nz); break }
      }
    }
  }
  return seen
}

/**
 * EVERY FEET CELL FROM WHICH A BODY WALKS TO `target` -> Set of bk. Pure. walkReach's moves run backwards, so
 * walkReachBack(r, t).has(c) iff walkReach(r, c).has(t) (a property test checks it).
 */
export function walkReachBack (read, target, { box = null, forbid = () => false, maxNodes = 120_000 } = {}) {
  const seen = new Set()
  if (!target || !standable(read, target.x, target.y, target.z)) return seen
  const inBox = inBoxOf(box)
  const ok = (x, y, z) => inBox(x, y, z) && !forbid(x, y, z) && standable(read, x, y, z)
  const q = [[target.x, target.y, target.z]]
  seen.add(bk(target.x, target.y, target.z))
  const push = (x, y, z) => { const k = bk(x, y, z); if (!seen.has(k)) { seen.add(k); q.push([x, y, z]) } }
  for (let i = 0; i < q.length && seen.size < maxNodes; i++) {
    const [x, y, z] = q[i]
    for (const [dx, dz] of CARD) {
      const ax = x - dx, az = z - dz
      if (ok(ax, y, az)) push(ax, y, az)
      if (ok(ax, y - 1, az) && passable(read(ax, y + 1, az))) push(ax, y - 1, az)
      for (let d = 1; d <= 3; d++) {
        const ya = y + d
        let clear = true
        // EXACTLY walkReach's walk-off-and-drop tests (Claude stage-3 r1 P3; plinth's copy checked the box and forbid one cell
        // higher -- safe-side, but not the inverse): the box at the walk-off height, forbid from there down, open to the head
        for (let c = y; c <= ya + 1; c++) { if ((c === ya && !inBox(x, c, z)) || (c <= ya && forbid(x, c, z)) || !passable(read(x, c, z))) { clear = false; break } }
        if (!clear) break
        if (ok(ax, ya, az)) push(ax, ya, az)
      }
    }
  }
  return seen
}

/** Can a body at `from` walk to `to`? (the walk is not symmetric: asked in this direction). Pure. */
export function walksTo (read, from, to, { box = null, forbid = () => false } = {}) {
  if (!from || !to) return false
  return walkReach(read, from, { box, forbid, until: bk(to.x, to.y, to.z) }).has(bk(to.x, to.y, to.z))
}

// ---- one click (plinth.mjs faceCentre / sightClear / supportsFor / refUsable / standFor / standOk) ---------------------

export const faceCentre = (ref, face) => ({ x: ref.x + 0.5 + face[0] * 0.5, y: ref.y + 0.5 + face[1] * 0.5, z: ref.z + 0.5 + face[2] * 0.5 })

/** Is the segment eye -> point open (sampled every 0.05, the clicked face itself excluded; `through` = the target)? Pure. */
export function sightClear (read, eye, point, through = new Set()) {
  const dx = point.x - eye.x, dy = point.y - eye.y, dz = point.z - eye.z
  const n = Math.max(2, Math.ceil(Math.hypot(dx, dy, dz) / 0.05))
  for (let i = 0; i <= n * 0.98; i++) {
    const t = i / n
    const x = Math.floor(eye.x + dx * t), y = Math.floor(eye.y + dy * t), z = Math.floor(eye.z + dz * t)
    if (through.has(bk(x, y, z))) continue
    const b = read(x, y, z)
    if (!b || b.boundingBox !== 'empty') return false
  }
  return true
}

/** May a click use this block as its support? Solid, not a liquid, not a block the click would USE (it opens). Pure. */
export function refUsable (b) {
  return solid(b) && !LIQUID.test(b.name ?? '') && !/_trapdoor$|_door$|^chest$|^trapped_chest$|^barrel$|_shulker_box$|^crafting_table$|furnace$|^smoker$|^hopper$|^lectern$/.test(b.name ?? '')
}

/** The faces a placement into `cell` may click -> [{ ref, face }]: the block BELOW first, then the four sides; never above. */
export function supportsFor (read, cell) {
  const out = []
  for (const [dx, dy, dz] of FACES) {
    const ref = { x: cell.x + dx, y: cell.y + dy, z: cell.z + dz }
    if (!refUsable(read(ref.x, ref.y, ref.z))) continue
    out.push({ ref, face: [-dx || 0, -dy || 0, -dz || 0] })
  }
  return out
}

/**
 * WHERE TO STAND FOR ONE CLICK -> { x, y, z } | null. Pure. A feet cell in `reach` (a Set-like of bk), never `avoid`, never
 * the target cell (feet or head), the eye within BUILD_REACH of the clicked point, ABOVE it for a top face, with a clear
 * line of sight. Nearest to `prefer` (else to the target), then the lowest key: deterministic.
 */
export function standFor (read, { target, point, topFace = false, reach, avoid = () => false, prefer = null, radius = 5 }) {
  let best = null
  const through = new Set([bk(target.x, target.y, target.z)])
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dy = -4; dy <= 3; dy++) {
        const x = target.x + dx, y = target.y + dy, z = target.z + dz
        const k = bk(x, y, z)
        if (!reach.has(k)) continue
        if (avoid(x, y, z) || avoid(x, y + 1, z)) continue
        if (x === target.x && z === target.z && (y === target.y || y + 1 === target.y)) continue
        const eye = { x: x + 0.5, y: y + EYE_HEIGHT, z: z + 0.5 }
        if (topFace && eye.y <= point.y + 1e-9) continue
        if (Math.hypot(eye.x - point.x, eye.y - point.y, eye.z - point.z) > BUILD_REACH) continue
        if (!sightClear(read, eye, point, through)) continue
        const d = prefer ? Math.hypot(x - prefer.x, y - prefer.y, z - prefer.z) : Math.hypot(dx, dy, dz)
        if (!best || d < best.d - 1e-9 || (Math.abs(d - best.d) <= 1e-9 && k < best.k)) best = { x, y, z, d, k }
      }
    }
  }
  return best ? { x: best.x, y: best.y, z: best.z } : null
}

/**
 * IS THIS STAND GOOD FOR THIS CLICK, IN THE WORLD AS IT IS NOW? -> null | reason. Pure; asked again at the click's turn
 * (the bot may have arrived somewhere else): standable, not avoided, not the target, in reach, above a top face, a clear
 * sight -- and after the placement the stand still walks to `start`.
 */
export function standOk (read, { stand, target, point, topFace = false, start, box = null, forbid = () => false }) {
  if (!stand || !target || !point || !start) return 'incomplete'
  const { x, y, z } = stand
  if (!standable(read, x, y, z)) return 'not standable'
  if (forbid(x, y, z) || forbid(x, y + 1, z)) return 'forbidden stand'
  if (x === target.x && z === target.z && (y === target.y || y + 1 === target.y)) return 'in the target cell'
  if (x === target.x && z === target.z && y - 1 === target.y) return 'standing on the target'
  const eye = { x: x + 0.5, y: y + EYE_HEIGHT, z: z + 0.5 }
  if (topFace && eye.y <= point.y + 1e-9) return 'below the top face'
  if (Math.hypot(eye.x - point.x, eye.y - point.y, eye.z - point.z) > BUILD_REACH) return 'out of reach'
  if (!sightClear(read, eye, point, new Set([bk(target.x, target.y, target.z)]))) return 'no line of sight'
  const after = overlay(read, new Map([[bk(target.x, target.y, target.z), PLACED]]))
  if (!walksTo(after, stand, start, { box, forbid })) return 'walled in after the click'
  return null
}

// ---- bodies ----------------------------------------------------------------------------------------------------------

/** A clear's stand, re-proved where the bot is: standable, not avoided, the block's centre in reach and in sight. Pure. */
export function standOkClear (read, { stand, target, point, forbid = () => false }) {
  if (!stand || !target || !point) return 'incomplete'
  const { x, y, z } = stand
  if (!standable(read, x, y, z)) return 'not standable'
  if (forbid(x, y, z) || forbid(x, y + 1, z)) return 'forbidden stand'
  if (x === target.x && z === target.z && (y === target.y || y + 1 === target.y)) return 'in the target cell'
  const eye = { x: x + 0.5, y: y + EYE_HEIGHT, z: z + 0.5 }
  if (Math.hypot(eye.x - point.x, eye.y - point.y, eye.z - point.z) > BUILD_REACH) return 'out of reach'
  if (!sightClear(read, eye, point, new Set([bk(target.x, target.y, target.z)]))) return 'no line of sight'
  return null
}

/** Does a body ({ x, y, z } feet centre, w, h) overlap block cell c? Pure (blueprint.mjs bodyInCell's rule). */
export function bodyInCell (b, c) {
  const hw = (Number(b?.w) || 0.6) / 2, h = Number(b?.h) || 1.8
  return b?.x + hw > c.x && b.x - hw < c.x + 1 && b.z + hw > c.z && b.z - hw < c.z + 1 && b.y + h > c.y && b.y < c.y + 1
}
/** A body touches the cell or the cell above it: the cell waits (design 3.3, Claude r1 P2-13). Pure. */
export const bodyBlocks = (bodies, c) => (bodies ?? []).some(b => bodyInCell(b, c) || bodyInCell(b, { x: c.x, y: c.y + 1, z: c.z }))

// ---- the work ------------------------------------------------------------------------------------------------------

/** Would a placement wall a body in? -> true when some body's feet walk to the town before (`before`) and not after (`after`). */
export function wallsInBody (bodies, before, after) {
  return (bodies ?? []).map(b => ({ x: Math.floor(b.x), y: Math.floor(b.y + 1e-6), z: Math.floor(b.z) }))
    .some(f => before.has(bk(f.x, f.y, f.z)) && !after.has(bk(f.x, f.y, f.z)))
}

/** Is a cell what the list wants? `want` = name | (block) -> boolean; absent: any solid block. Pure. */
export const cellDone = (b, want) => !!b && (typeof want === 'function' ? !!want(b) : typeof want === 'string' ? b.name === want : solid(b))

/**
 * WHAT IS LEFT OF A LIST, READ FROM THE WORLD -> { done, open, blocked, unknown, total, left: [cell] }. Pure. open = the
 * cell is replaceable now; blocked = it holds something else (never dug: the caller decides -- waive, degrade, report);
 * unknown = not loaded (never a guess).
 */
export function buildProgress (read, cells = [], { fillable = replaceable, clearable = () => false } = {}) {
  const out = { done: 0, open: 0, clear: 0, blocked: 0, unknown: 0, total: 0, left: [] }
  for (const c of cells) {
    out.total++
    const b = read(c.x, c.y, c.z)
    if (!b) { out.unknown++; continue }
    if (cellDone(b, c.want)) { out.done++; continue }
    if (fillable(b)) { out.open++; out.left.push(c) } else if (clearable(b)) { out.clear++; out.left.push(c) } else out.blocked++
  }
  return out
}

/**
 * THE NEXT PLACEMENT -> { step: { cell, ref, face, point, topFace, stand } } | { step: null, why, stuck }. Pure.
 *   todo     the open cells, in the caller's priority order (only the first feasible one is taken)
 *   start    the feet cell the builder must always be able to walk back to (the town, the apron)
 *   reach    optional precomputed walkReach(read, start) (the executor's per-step cache)
 *   bodies   other entities ({ x, y, z, w, h }): a cell they touch, or touch the cell above, waits
 *   skip     (cell) -> true for cells this visit gave up on (two failed clicks)
 *   fillable (block) -> may a block be placed INTO it (default: replaceable; the monument adds water)
 *   clearable (block) -> a non-solid block a bare hand removes at once (a flower): a CLEAR step (op 'clear') comes first --
 *            no support, a stand in reach of the block's centre with a clear sight (removing it never walls anyone in)
 * A cell is feasible when it is replaceable, no open cell of the list lies below it in its column, a body does not block
 * it, it has a support face, and a stand that the town reaches before the click and that walks back to the town after it.
 */
export function nextPlacement (read, { todo = [], start, box = null, forbid = () => false, bodies = [], prefer = null, reach = null, skip = () => false, scan = Infinity,
  fillable = replaceable, clearable = () => false }) {
  if (!start) return { step: null, why: 'no_start', stuck: [] }
  const r = reach ?? walkReach(read, start, { box, forbid })
  if (!r.has(bk(start.x, start.y, start.z))) return { step: null, why: 'start_not_standable', stuck: [] }
  const openCols = new Map()                       // column -> lowest open y in the list
  for (const c of todo) {
    const b0 = read(c.x, c.y, c.z)
    if (!fillable(b0) && !clearable(b0)) continue
    const k = `${c.x},${c.z}`
    if (!openCols.has(k) || c.y < openCols.get(k)) openCols.set(k, c.y)
  }
  const stuck = []
  let looked = 0, backNow = null
  for (const c of todo) {
    if (looked >= scan) break
    if (skip(c)) continue
    const now = read(c.x, c.y, c.z)
    if (clearable(now)) {
      // A CLEAR STEP: the block's centre in reach and sight from a stand the town reaches (a flower walls nobody in)
      looked++
      const point = { x: c.x + 0.5, y: c.y + 0.5, z: c.z + 0.5 }
      const stand = standFor(read, { target: c, point, topFace: false, reach: r, avoid: forbid, prefer })
      if (stand) return { step: { op: 'clear', cell: c, ref: null, face: null, point, topFace: false, stand }, why: null, stuck }
      stuck.push(`${c.x},${c.y},${c.z}:stand`)
      continue
    }
    if (!fillable(now)) continue
    if (openCols.get(`${c.x},${c.z}`) < c.y) continue                     // bottom-up in every column
    looked++
    if (bodyBlocks(bodies, c)) { stuck.push(`${c.x},${c.y},${c.z}:body`); continue }
    const options = supportsFor(read, c).map(s => ({ ref: s.ref, face: s.face, point: faceCentre(s.ref, s.face), topFace: s.face[1] === 1 }))
    if (!options.length) { stuck.push(`${c.x},${c.y},${c.z}:support`); continue }
    if (!options.some(o => standFor(read, { target: c, point: o.point, topFace: o.topFace, reach: r, avoid: forbid }))) { stuck.push(`${c.x},${c.y},${c.z}:stand`); continue }
    // THE WORLD AFTER THIS CLICK: who walks BACK to the town (a drop of 3 is a move, a climb of 2 is not -- plinth Codex r2 P1-1)
    const back = walkReachBack(overlay(read, new Map([[bk(c.x, c.y, c.z), PLACED]])), start, { box, forbid })
    // ...AND NO BYSTANDER LOSES ITS WAY OUT (Claude stage-3 r1 P2-1: bottom-up raised every column around a body that stood
    // still, a pit and then a shaft): a body whose feet walk to the town now must still walk there after the click
    if (bodies.length) {
      backNow ??= walkReachBack(read, start, { box, forbid })
      if (wallsInBody(bodies, backNow, back)) { stuck.push(`${c.x},${c.y},${c.z}:body_walled`); continue }
    }
    const usable = { has: k => r.has(k) && back.has(k) }
    for (const o of options) {
      const stand = standFor(read, { target: c, point: o.point, topFace: o.topFace, reach: usable, avoid: forbid, prefer })
      if (stand) return { step: { op: 'place', cell: c, ref: o.ref, face: o.face, point: o.point, topFace: o.topFace, stand }, why: null, stuck }
    }
    stuck.push(`${c.x},${c.y},${c.z}:walled_in`)
  }
  // every reason counted (the first 8 cells named): a caller tells "bodies in the way" from "nothing placeable"
  const reasons = {}
  for (const s of stuck) { const r = s.slice(s.lastIndexOf(':') + 1); reasons[r] = (reasons[r] ?? 0) + 1 }
  return { step: null, why: todo.length ? 'no_feasible_cell' : 'nothing_to_do', stuck: stuck.slice(0, 8), reasons }
}

/**
 * THE OFFLINE PROOF: can this list be built, in this order, from `start`, in this world? -> { steps } | { why, stuck, steps }.
 * Pure (a generator that yields after every step, so a bot's event loop runs; sequence() drains it). Each step is
 * nextPlacement on the world with every earlier step placed. Bodies are not modelled (they move).
 */
export function * sequenceSteps (read0, cells, { start, box = null, forbid = () => false, maxSteps = 100_000 } = {}) {
  const placed = new Map()
  const read = overlay(memo(read0), placed)
  const todo = cells.filter(c => !cellDone(read(c.x, c.y, c.z), c.want))
  const blocked = todo.filter(c => !replaceable(read(c.x, c.y, c.z)))
  if (blocked.length) return { why: 'blocked', stuck: blocked.slice(0, 8).map(c => `${c.x},${c.y},${c.z}`), steps: [] }
  const steps = []
  let prefer = start
  while (placed.size < todo.length && steps.length < maxSteps) {
    yield steps.length
    const left = todo.filter(c => !placed.has(bk(c.x, c.y, c.z)))
    const n = nextPlacement(read, { todo: left, start, box, forbid, prefer })
    if (!n.step) return { why: n.why, stuck: n.stuck, steps }
    const { cell, stand, ref, face } = n.step
    placed.set(bk(cell.x, cell.y, cell.z), PLACED)
    steps.push({ c: [cell.x, cell.y, cell.z], r: [ref.x, ref.y, ref.z], f: face, s: [stand.x, stand.y, stand.z] })
    prefer = stand
  }
  // A PROOF CUT SHORT IS NOT A PROOF (Codex stage-3 r1 P2-5)
  if (placed.size < todo.length) return { why: 'max_steps', stuck: [], steps }
  return { steps }
}
export function sequence (read, cells, opts = {}) {
  const it = sequenceSteps(read, cells, opts)
  for (;;) { const r = it.next(); if (r.done) return r.value }
}

// ---- the executor (effects injected) ---------------------------------------------------------------------------------

/** The cells' bounding box with `pad` around (y: -pad..+pad) -> box. Pure. */
export function boxAround (cells, pad = 8) {
  const b = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, z0: Infinity, z1: -Infinity }
  for (const c of cells) {
    if (!c) continue
    if (c.x < b.x0) b.x0 = c.x; if (c.x > b.x1) b.x1 = c.x; if (c.y < b.y0) b.y0 = c.y; if (c.y > b.y1) b.y1 = c.y; if (c.z < b.z0) b.z0 = c.z; if (c.z > b.z1) b.z1 = c.z
  }
  return { x0: b.x0 - pad, x1: b.x1 + pad, y0: b.y0 - pad, y1: b.y1 + pad, z0: b.z0 - pad, z1: b.z1 + pad }
}

/** At most this many clicks per cell per visit (design 3.5: one click per 4 ticks, at most 2 attempts). */
export const BUILD_ATTEMPTS = 2

/**
 * ONE VISIT'S PLACEMENTS -> { placed, refused, silent, unreachable, stop, why, stuck, cells: [{ c, verdict }] }.
 * Every effect is injected, so the loop is tested on a fake world and wired to mineflayer by the caller:
 *   read(x, y, z)            the live world (re-read every step: the list is re-derived, never counted)
 *   cells                    the frozen list in priority order ({ x, y, z, want })
 *   feet()                   the bot's feet cell now
 *   bodies()                 other entities now
 *   walkTo(stand)            -> truthy when the walk ended (anywhere: the stand is re-proved where the bot is)
 *   hold(cell)               -> true when a block for this cell is in hand; false = out of material (the visit ends)
 *   fence()                  -> true while this builder may still mutate (lease, record generation)
 *   clear(step, gate)        -> the same verdicts for a CLEAR step (the cell's block broken by hand); only with `clearable`
 *   nearest                  true: each step tries the open cells nearest the bot's feet first (the caller's order breaks ties)
 *   fillable, clearable      as nextPlacement. The result carries timings: gateMs (per gate) and planMs (per step).
 *   click(step, gate)        -> 'confirmed' | 'refused' | 'silent' (the server's word: the caller's witness) | 'gate:<why>'.
 *                               The adapter does its awaits (look, the tick pacing) FIRST, then calls gate() -- null to
 *                               click, else the reason not to -- and clicks with NO await between (Codex stage-3 r1 P1-1:
 *                               a lease lost or an abort during the look must not still place)
 *   aborted()                the skill's signal
 * `box` bounds every walk search; when null it is derived from the cells and the start (+8 around, -8..+8 in y) -- an
 * unbounded search over bot.blockAt is hundreds of thousands of synchronous reads a step (Claude stage-3 r1 P2-6).
 * Stops: complete | blocked | unknown | no_step | no_material | fence | max_steps | deadline | aborted. `complete` only when
 * every cell reads done; open cells none placeable now are `no_step`; only blocked (foreign) or unloaded cells left are
 * `blocked` / `unknown` (Codex stage-3 r1 P2-5: never a success-shaped stop for an unfinished list).
 */
export async function runPlacements ({ read, cells, start, box = null, forbid = () => false, feet, bodies = () => [], walkTo, hold, fence, click,
  aborted = () => false, maxSteps = 40, deadline = Infinity, now = () => Date.now(), scan = Infinity, self = null,
  clear = null, clearable = () => false, fillable = replaceable, nearest = false, clock = () => performance.now() }) {
  const out = { placed: 0, cleared: 0, refused: 0, silent: 0, unreachable: 0, stop: null, why: null, stuck: [], cells: [], gateMs: [], planMs: [] }
  box ??= boxAround([...cells, start])
  const live = read
  const tries = new Map()
  const gaveUp = new Set()
  const skip = c => gaveUp.has(bk(c.x, c.y, c.z))
  const fail = (c, verdict) => {
    out.cells.push({ c: [c.x, c.y, c.z], verdict })
    const k = bk(c.x, c.y, c.z), n = (tries.get(k) ?? 0) + 1
    tries.set(k, n)
    if (n >= BUILD_ATTEMPTS) gaveUp.add(k)
  }
  const timed = fn => () => { const t0 = clock(); try { return fn() } finally { out.gateMs.push(clock() - t0) } }
  for (let steps = 0; ; steps++) {
    if (aborted()) { out.stop = 'aborted'; break }
    if (steps >= maxSteps) { out.stop = 'max_steps'; break }
    if (now() > deadline) { out.stop = 'deadline'; break }
    read = memo(live)                                       // one coherent, cached view per step; re-read every step
    const tPlan = clock()
    const prog = buildProgress(read, cells, { fillable, clearable })
    if (prog.done === prog.total) { out.stop = 'complete'; break }
    if (!prog.left.length) { out.stop = prog.unknown ? 'unknown' : 'blocked'; out.why = `${prog.blocked} blocked, ${prog.unknown} unloaded`; break }
    // NEAREST FIRST (coordinator 10-15): the open cells by distance from the bot's feet now -- the walk is the cost
    let todo = prog.left
    if (nearest) { const f = feet(); todo = [...todo].sort((a, b) => Math.hypot(a.x - f.x, a.y - f.y, a.z - f.z) - Math.hypot(b.x - f.x, b.y - f.y, b.z - f.z)) }
    const n = nextPlacement(read, { todo, start, box, forbid, bodies: bodies(), prefer: feet(), skip, scan, fillable, clearable })
    out.planMs.push(clock() - tPlan)
    if (!n.step) { out.stop = 'no_step'; out.why = n.why; out.stuck = n.stuck; out.reasons = n.reasons ?? {}; break }
    const s = n.step, c = s.cell
    await walkTo(s.stand)
    if (aborted()) { out.stop = 'aborted'; break }
    read = memo(live)                                       // the walk changed the world around the bot: a fresh view
    if (s.op === 'clear') {
      // A CLEAR: re-proved where the bot is (standable, in reach, in sight), then a gate of the same shape -- no material,
      // no support and no walk-back (removing a non-solid block walls nobody in)
      const bad = standOkClear(read, { stand: feet(), target: c, point: s.point, forbid })
      if (bad) { out.unreachable++; fail(c, `stand:${bad}`); continue }
      const gateC = timed(() => {
        if (aborted()) return 'aborted'
        const nw = memo(live)
        if (!clearable(nw(c.x, c.y, c.z))) return 'cell_changed'
        const st = standOkClear(nw, { stand: feet(), target: c, point: s.point, forbid })
        if (st) return `stand:${st}`
        if (!fence()) return 'fence'
        return null
      })
      if (typeof clear !== 'function') { fail(c, 'no_clear_effect'); continue }
      if (gateC() === 'fence') { out.stop = 'fence'; break }
      const v = await clear(s, gateC)
      if (v === 'gate:aborted') { out.stop = 'aborted'; break }
      if (v === 'gate:fence') { out.stop = 'fence'; break }
      if (typeof v === 'string' && v.startsWith('gate:')) { fail(c, v.slice(5)); continue }
      if (v === 'confirmed') { out.cleared++; out.cells.push({ c: [c.x, c.y, c.z], verdict: 'cleared' }); continue }
      if (v === 'refused') out.refused++; else out.silent++
      fail(c, v)
      continue
    }
    // RE-PROVED WHERE THE BOT IS (it may have stopped short, or somewhere else as good): never a click from a stand the
    // planner would refuse -- out of reach, under a top face, or one that walls it in
    const bad = standOk(read, { stand: feet(), target: c, point: s.point, topFace: s.topFace, start, box, forbid })
    if (bad) { out.unreachable++; fail(c, `stand:${bad}`); continue }
    if (!(await hold(c))) { out.stop = 'no_material'; break }
    // THE GATE, asked by the adapter after its last await and immediately before the click packet: everything that can
    // change while it waits -- the abort, the cell, its support, a body walking in, and LAST the fence (tendFarm's rule)
    // ...AND EVERY PROOF THE PLAN MADE, AGAIN, on a fresh view (Codex stage-3 r2 P1-1: a bystander walked into a dead end
    // during the equip, and the bot itself may have shifted during the look): the stand where the bot is now, and no body
    // that walks out now is walled in by this click
    const gate = timed(() => {
      if (aborted()) return 'aborted'
      const nw = memo(live)
      if (!fillable(nw(c.x, c.y, c.z))) return 'cell_changed'
      if (!refUsable(nw(s.ref.x, s.ref.y, s.ref.z))) return 'support_changed'
      const bs = bodies()
      if (bodyBlocks([...bs, ...(self ? [self()] : [])], c)) return 'body'
      const st = standOk(nw, { stand: feet(), target: c, point: s.point, topFace: s.topFace, start, box, forbid })
      if (st) return `stand:${st}`
      if (bs.length && wallsInBody(bs, walkReachBack(nw, start, { box, forbid }), walkReachBack(overlay(nw, new Map([[bk(c.x, c.y, c.z), PLACED]])), start, { box, forbid }))) return 'body_walled'
      if (!fence()) return 'fence'
      return null
    })
    if (gate() === 'fence') { out.stop = 'fence'; break }   // a lease already lost: no look, no wait
    const v = await click(s, gate)
    if (v === 'gate:aborted') { out.stop = 'aborted'; break }
    if (v === 'gate:fence') { out.stop = 'fence'; break }
    if (typeof v === 'string' && v.startsWith('gate:')) { fail(c, v.slice(5)); continue }
    if (v === 'confirmed') { out.placed++; out.cells.push({ c: [c.x, c.y, c.z], verdict: v }); continue }
    if (v === 'refused') out.refused++; else out.silent++
    fail(c, v)
  }
  return out
}
