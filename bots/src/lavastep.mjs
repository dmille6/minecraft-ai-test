// LAVASTEP-01 (F1 of docs/reports/mineshaft-safety-2026-10-23.md; OWNER 2026-10-23 O1 "yes"). PURE: no bot, no clock.
//
// WHY. The danger arm (reflex.mjs) fired `escape()` -- sprint + forward + jump for 1.5 s in WHATEVER DIRECTION THE BOT
// FACED -- every 2.5 s while the feet cell or the cell below was lava, fire, campfire, soul fire or magma. Measured 7 d to
// 10-23 (ES, 80 bots): 84 fire deaths, all lava or magma; 81 idle at death; 67 inside or within 20 s of a danger episode.
// An episode that started with dry feet over a DANGER block ended in a lava death 31 times of 303; one that started with
// the feet already in lava, 32 of 74. A bot that faces the lava it walked toward is sprinted into it. That is an
// association, not proof; the effect evidence is Paper.
//
// THE DECISION, in one place, so it is tested by behaviour (CLAUDE.md "extract the decision"):
//   dangerCase   which of `in` / `airborne` / `edge` the firing is (exhaustive; precedence in > airborne > edge)
//   stepPlan     a breadth-first search of <= 3 verified steps (|dy| <= 1, 4 neighbours each) to a lava-safe cell
//   sealPlan     `edge` only: a cobble placed into a REPLACEABLE danger cell under the centre, against a solid face
//   aimScores    with no plan and no seal: the 8 bearings scored over 6 cells for support, collision and DANGER
//   chooseBearing  the best scored bearing (O1: never stand still)
//   stuckRelax   three firings that did not move the bot on a magma/campfire floor -> a 60 s relaxation of that cell
// reflex.mjs executes the plan under a priority runner reservation and a generation token; every input read here is
// recorded (recordingAt) so the read recomputes every gate from the cells the bot saw, never from its own verdict.
//
// `at(x, y, z)` returns a block ({ name, boundingBox }) or null/undefined for an UNKNOWN (unloaded) cell. Unknown refuses.
import { cellLavaSafe, cellSupported, LAVA_LIKE } from './lavaguard.mjs'

/** THE ARM'S TRIGGER SET -- the same five names as reflex.mjs DANGER_BLOCKS (lavastep.test.mjs holds them equal). */
export const DANGER = new Set(['lava', 'fire', 'campfire', 'soul_fire', 'magma_block'])
/** Non-DANGER liquids: feet in one of these with DANGER below is `in` (a bot in water over magma is not on an edge). */
export const WET = new Set(['water', 'flowing_water', 'bubble_column'])
/** Cells a block can be PLACED into (vanilla #replaceable): lava and fire are; magma and campfires are blocks. */
export const REPLACEABLE = new Set(['lava', 'flowing_lava', 'fire', 'soul_fire'])
/** The only seal blocks: the fleet's commonest scaffold, never a tool, a log or a town item. */
export const SEAL_ITEMS = ['cobblestone', 'cobbled_deepslate']
/**
 * The only floors a stuck firing may relax: blocks that hurt without burning. Lava and fire are NEVER relaxed.
 * soul_campfire is listed because the design lists it; it is unreachable today (not in DANGER, so the arm never fires on it).
 * Sneaking stops magma damage (minecraft.wiki); it does NOT stop campfire damage -- a relaxed campfire hands the bot to
 * the ordinary escape arms while it still takes 1 HP / 0.5 s, so that relaxation buys a handover, not safety.
 */
export const RELAXABLE = new Set(['magma_block', 'campfire', 'soul_campfire'])

export const MOVE_MS = 6000            // the reservation and the generation deadline: the whole move, however it ends
export const STEP_IN_MS = 1000         // an `in` step (lava slows movement; a missed step goes straight to the aim)
export const STEP_EDGE_MS = 1500       // an `edge` step (a walk)
export const AIM_MS = 1500             // the aimed sprint-jump (today's escape() duration, on a chosen bearing)
export const AIM_CELLS = 6             // cells scored per bearing (the origin is not counted)
export const PLAN_MAX_STEPS = 3
export const SEAL_WITNESS_MS = 1000
export const REASSERT_MS = 50
export const STUCK_FIRINGS = 3         // consecutive firings that moved the bot < STUCK_MOVE
export const STUCK_MOVE = 0.5
export const RELAX_MS = 60_000
export const ARRIVE_R = 0.3            // a step has arrived inside this radius of the destination's centre (lavaStandOff's)

/** LAVASTEP=0 restores the blind sprint exactly (the one-setting rollback); unset or anything else leaves it on. */
export const lavastepOn = (env = typeof process !== 'undefined' ? process.env : {}) => String(env?.LAVASTEP ?? '1') !== '0'

const isDanger = b => !!b && (DANGER.has(b.name) || LAVA_LIKE.has(b.name))
const solid = b => !!b && b.boundingBox === 'block'
const passable = b => !!b && b.boundingBox !== 'block' && !isDanger(b)

/**
 * WHICH CASE. `feet` / `below` are block NAMES (a relaxed cell is passed as null by the caller); onGround as mineflayer
 * reports it. -> 'in' | 'airborne' | 'edge', or null when neither cell is DANGER (the arm does not fire).
 *   in        the feet cell is DANGER, or the feet are in a non-DANGER liquid with DANGER below
 *   airborne  not on the ground, feet not in liquid (the caller never classifies while a move is in flight)
 *   edge      on the ground, feet not DANGER, the cell below DANGER (lava under the centre, a magma or campfire floor)
 */
export function dangerCase ({ feet = null, below = null, onGround = true } = {}) {
  const fD = DANGER.has(feet), bD = DANGER.has(below)
  if (!fD && !bD) return null
  if (fD) return 'in'
  if (WET.has(feet)) return 'in'
  if (!onGround) return 'airborne'
  return 'edge'
}

const CARD = [[1, 0], [-1, 0], [0, 1], [0, -1]]
const key = c => `${c[0]},${c[1]},${c[2]}`
/** The swept 3-wide body line: the perpendicular offsets of a cardinal step (lavaStandOff's `lateral`). */
export const lateralOf = (dx) => dx ? [[0, -1], [0, 0], [0, 1]] : [[-1, 0], [0, 0], [1, 0]]

/**
 * ONE STEP from `from` (feet cell [x,y,z]) along cardinal (dx,dz), its height chosen as the first standable of dy 0, +1, -1.
 * first: the plan's first step (its origin is the hazard being left: the origin centre is exempt from the sweep, and in
 * `in` its lateral cells too). -> { ok, to, dy, goal, why }.
 *   standable  feet and head known, passable, not DANGER; floor known, solid, not DANGER
 *   clearance  dy +1: the cell over the origin's head is passable (the jump); dy -1: the cell over the destination's head
 *   sweep      lavaStandOff's exact test: every lateral cell of the origin and of the destination supported and not lava
 *   unknown    every cell read -- body, floor, clearance, each swept cell and the cells under it -- must be known
 *   lava-safe  every destination is cellLavaSafe. The GOAL strictly (lavaStandOff's retreat test); an INTERMEDIATE step with
 *              the plan origin's own feet cell -- the hazard being left, exempt like the rest of the origin -- read as air.
 *              Nothing else is exempt. Without that one exemption no `in` plan could exist (every neighbour of a lava
 *              origin has the origin's lava beside it), against the design's "a plan exists mainly when the bot stands in
 *              1-wide lava beside a dry edge"; with it, the bot walks onto the shore cell beside the lava and on to a cell
 *              with no lava beside it at all.
 * `origin` is the plan's origin (defaults to `from`).
 */
const AIR = { name: 'air', boundingBox: 'empty' }
export function evalStep (at, from, dx, dz, { first = false, kase = 'edge', origin = from } = {}) {
  const [fx, fy, fz] = from
  const x = fx + dx, z = fz + dz
  let pick = null, why0 = null
  for (const dy of [0, 1, -1]) {
    const y = fy + dy
    const feet = at(x, y, z), head = at(x, y + 1, z), floor = at(x, y - 1, z)
    let why = null
    if (feet == null || head == null || floor == null) why = 'unknown'
    else if (isDanger(feet) || isDanger(head)) why = `danger body (${isDanger(feet) ? feet.name : head.name})`
    else if (!passable(feet) || !passable(head)) why = 'body blocked'
    else if (isDanger(floor)) why = `danger floor (${floor.name})`
    else if (!solid(floor)) why = 'no floor'
    else if (dy === 1) { const over = at(fx, fy + 2, fz); if (over == null) why = 'unknown'; else if (!passable(over)) why = 'no jump room' }
    else if (dy === -1) { const over = at(x, y + 2, z); if (over == null) why = 'unknown'; else if (!passable(over)) why = 'no room to step down' }
    if (!why) { pick = { y, dy }; break }
    if (dy === 0) why0 = why
  }
  if (!pick) return { ok: false, to: [x, fy, z], dy: 0, goal: false, why: why0 }
  const to = [x, pick.y, z]
  for (const [lx, lz] of lateralOf(dx)) {
    const centre = lx === 0 && lz === 0
    const exempt = first && (centre || kase === 'in')
    if (!exempt) {
      const o = at(fx + lx, fy, fz + lz)
      if (o == null) return { ok: false, to, dy: pick.dy, goal: false, why: `sweep unknown at ${fx + lx},${fy},${fz + lz}` }
      if (isDanger(o)) return { ok: false, to, dy: pick.dy, goal: false, why: `sweep danger at ${fx + lx},${fy},${fz + lz}` }
      if (!cellSupported(at, fx + lx, fy, fz + lz)) return { ok: false, to, dy: pick.dy, goal: false, why: `sweep unsupported at ${fx + lx},${fy},${fz + lz}` }
    }
    const d = at(to[0] + lx, to[1], to[2] + lz)
    if (d == null) return { ok: false, to, dy: pick.dy, goal: false, why: `sweep unknown at ${to[0] + lx},${to[1]},${to[2] + lz}` }
    if (isDanger(d)) return { ok: false, to, dy: pick.dy, goal: false, why: `sweep danger at ${to[0] + lx},${to[1]},${to[2] + lz}` }
    if (!cellSupported(at, to[0] + lx, to[1], to[2] + lz)) return { ok: false, to, dy: pick.dy, goal: false, why: `sweep unsupported at ${to[0] + lx},${to[1]},${to[2] + lz}` }
  }
  const strict = cellLavaSafe(at, to[0], to[1], to[2])
  if (strict.safe) return { ok: true, to, dy: pick.dy, goal: true, why: 'goal' }
  const [ox, oy, oz] = origin
  const exAt = (x, y, z) => (x === ox && y === oy && z === oz) ? AIR : at(x, y, z)
  const ls = cellLavaSafe(exAt, to[0], to[1], to[2])
  if (!ls.safe) return { ok: false, to, dy: pick.dy, goal: false, why: `not lava-safe: ${strict.why} at ${strict.cell?.join(',')}` }
  return { ok: true, to, dy: pick.dy, goal: false, why: 'step (lava-safe but for the origin)' }
}

/**
 * THE SEARCH. Breadth-first from `origin` (the feet cell), at most PLAN_MAX_STEPS steps; the first goal found (shortest,
 * in the fixed neighbour order +x, -x, +z, -z) is the plan. -> { plan: [{ to, dy }] | null, candidates: [...] } where
 * every evaluated step is recorded with its reject reason (the read replays this function on the recorded cells).
 */
export function stepPlan (at, origin, kase = 'edge', { maxSteps = PLAN_MAX_STEPS } = {}) {
  const seen = new Set([key(origin)])
  const queue = [{ cell: origin, depth: 0, path: [] }]
  const candidates = []
  while (queue.length) {
    const node = queue.shift()
    if (node.depth >= maxSteps) continue
    for (const [dx, dz] of CARD) {
      const r = evalStep(at, node.cell, dx, dz, { first: node.depth === 0, kase, origin })
      if (seen.has(key(r.to))) continue
      candidates.push({ from: node.cell, to: r.to, d: node.depth + 1, why: r.why })
      if (!r.ok) continue
      seen.add(key(r.to))
      const path = [...node.path, { to: r.to, dy: r.dy }]
      if (r.goal) return { plan: path, candidates }
      queue.push({ cell: r.to, depth: node.depth + 1, path })
    }
  }
  return { plan: null, candidates }
}

const INTERACTIVE = /chest|barrel|furnace|smoker|crafting_table|door|gate|trapdoor|button|lever|bed|shulker|anvil|hopper|dispenser|dropper|lectern|loom|grindstone|stonecutter|composter|cauldron|bell|note_block|jukebox|beacon|enchanting|brewing|cartography|fletching|smithing|respawn_anchor|campfire|sign/
/**
 * THE SEAL (`edge` only). The DANGER cell under the bot's centre, only when it is REPLACEABLE (lava, fire: a magma block
 * or a campfire cannot be placed into). The block is the first held of SEAL_ITEMS. The reference is a solid, non-DANGER,
 * non-interactive block ADJACENT to the cell (below it first, then the four sides; never the feet cell above it), and the
 * face clicked is the one pointing into the cell: within reach of a bot standing over it, and visible through the fluid
 * (raycasts ignore fluids). -> { ok, cell, ref, face, item, why }.
 */
export function sealPlan (at, origin, itemNames = []) {
  const cell = [origin[0], origin[1] - 1, origin[2]]
  const b = at(...cell)
  if (b == null) return { ok: false, cell, why: 'unknown cell' }
  if (!REPLACEABLE.has(b.name)) return { ok: false, cell, why: `not replaceable (${b.name})` }
  const have = new Set(itemNames)
  const item = SEAL_ITEMS.find(n => have.has(n))
  if (!item) return { ok: false, cell, why: 'no seal block held' }
  for (const [dx, dy, dz] of [[0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]) {
    const ref = [cell[0] + dx, cell[1] + dy, cell[2] + dz]
    const r = at(...ref)
    if (solid(r) && !isDanger(r) && !INTERACTIVE.test(r.name)) return { ok: true, cell, ref, face: [-dx, -dy, -dz], item, why: 'seal' }
  }
  return { ok: false, cell, item, why: 'no reference face' }
}

/** The 8 bearings, clockwise from north (-z), as [dx, dz]. */
export const BEARINGS = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]]
/** mineflayer's yaw for a heading (lookAt: atan2(-dx, -dz); lavaguard.stepLineSafe walks x = -sin, z = -cos). */
export const yawOf = ([dx, dz]) => Math.atan2(-dx, -dz)
/** The bearing index nearest a yaw. */
export function facingIndex (yaw = 0) {
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw)
  let best = 0, bd = -Infinity
  BEARINGS.forEach(([dx, dz], i) => { const n = Math.hypot(dx, dz); const d = (dx * fx + dz * fz) / n; if (d > bd + 1e-9) { bd = d; best = i } })
  return best
}

/**
 * THE AIM (no plan, no seal). For each bearing, the first AIM_CELLS cells along it at the feet level (the origin not
 * counted): supported = a known, solid, non-DANGER floor; collision = a feet or head cell not passable or unknown;
 * DANGER = DANGER/lava-like cells among feet, head and floor. The cell NAMES are returned so the read recomputes the
 * scores. -> [{ b: [dx,dz], support, collision, danger, cells: [[feet, head, floor], ...] }].
 */
export function aimScores (at, origin) {
  return BEARINGS.map(([dx, dz]) => {
    let support = 0, collision = 0, danger = 0
    const cells = []
    for (let k = 1; k <= AIM_CELLS; k++) {
      const x = origin[0] + dx * k, y = origin[1], z = origin[2] + dz * k
      const feet = at(x, y, z), head = at(x, y + 1, z), floor = at(x, y - 1, z)
      cells.push([feet?.name ?? null, head?.name ?? null, floor?.name ?? null])
      if (solid(floor) && !isDanger(floor)) support++
      if (!(feet != null && feet.boundingBox !== 'block' && head != null && head.boundingBox !== 'block')) collision++
      danger += [feet, head, floor].filter(isDanger).length
    }
    return { b: [dx, dz], support, collision, danger, cells }
  })
}

/**
 * THE BEST BEARING (O1). A bearing with full support and no collision, fewest DANGER cells; else (none has both) the
 * collision-free first, then the most supported cells, then the fewest DANGER, then the fewest collisions.
 * TIES (the design leaves them open): a CARDINAL bearing before a diagonal -- six diagonal cells are 8.5 blocks of travel
 * against 6, so an equal count of lava cells is 41% more time in lava, and a diagonal sprint clips block corners. Paper
 * 10-23 (sandbox, 1-wide ledge between two lava lakes, no cobble): S, SE and SW tied (3 supported, 3 lava) and the earlier
 * tie-break took a diagonal: 4 of 13 survived against the blind facing sprint's 15 of 20. Then the bearing FARTHEST from
 * the facing (the bot was walking toward the hazard), then clockwise. -> { index, b, key }. `aimKey` is what G5
 * recomputes; any bearing with the best key passes G5.
 */
export function aimKey (s) {
  const full = s.support === AIM_CELLS && s.collision === 0
  return full ? [0, 0, s.danger, 0] : [1, s.collision === 0 ? 0 : 1, -s.support * 100 + s.danger, s.collision]
}
const cmpKey = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0 }
export function chooseBearing (scores, yaw0 = 0) {
  const f = facingIndex(yaw0)
  const turn = i => { const d = Math.abs(i - f) % 8; return Math.min(d, 8 - d) }
  const diag = i => (i % 2 === 1 ? 1 : 0)            // BEARINGS alternate cardinal (even) and diagonal (odd)
  const tie = (i, j) => diag(i) !== diag(j) ? diag(i) - diag(j) : turn(j) - turn(i)   // < 0: i before j
  let best = null
  scores.forEach((s, i) => {
    const k = aimKey(s)
    if (!best || cmpKey(k, best.key) < 0 || (cmpKey(k, best.key) === 0 && tie(i, best.index) < 0)) best = { index: i, b: s.b, key: k }
  })
  return best
}

/**
 * THE ENCLOSED UNSEALABLE FLOOR. `history` = the displacement (blocks) of each firing, newest last; `cellName` the DANGER
 * block the bot stands on or in. -> true when the last STUCK_FIRINGS firings each moved the bot < STUCK_MOVE and the
 * block is RELAXABLE (magma, campfires). Lava and fire are never relaxed.
 */
export function stuckRelax (history = [], cellName = null) {
  if (!RELAXABLE.has(cellName)) return false
  if (history.length < STUCK_FIRINGS) return false
  return history.slice(-STUCK_FIRINGS).every(d => d < STUCK_MOVE)
}

/**
 * EVERY CELL THE DECISION READ, recorded relative to the origin so the read can replay it: `cells` maps "dx,dy,dz" to a
 * block name (null = unknown), `boxes` maps each name to its boundingBox. A cell never read is ABSENT (the replay counts
 * it as a missing read, distinct from an unknown one).
 */
export function recordingAt (at, origin) {
  const cells = {}, boxes = {}
  const fn = (x, y, z) => {
    const b = at(x, y, z)
    const k = `${x - origin[0]},${y - origin[1]},${z - origin[2]}`
    if (!(k in cells)) {
      cells[k] = b ? b.name : null
      if (b && !(b.name in boxes)) boxes[b.name] = b.boundingBox
    }
    return b
  }
  fn.cells = cells
  fn.boxes = boxes
  return fn
}

/**
 * THE WHOLE DECISION for one firing, on the cells as read now (no clock, no bot). -> { kase, plan, candidates, seal, aim }
 * where `aim` is filled only when there is no plan (the executor also asks for it after a failed `in` step).
 */
export function dangerMove ({ at, origin, feet, below, onGround, items = [], yaw0 = 0 }) {
  const kase = dangerCase({ feet, below, onGround })
  if (!kase || kase === 'airborne') return { kase, plan: null, candidates: [], seal: null, aim: null }
  const sp = stepPlan(at, origin, kase)
  if (sp.plan) return { kase, plan: sp.plan, candidates: sp.candidates, seal: null, aim: null }
  const seal = kase === 'edge' ? sealPlan(at, origin, items) : null
  const scores = aimScores(at, origin)
  return { kase, plan: null, candidates: sp.candidates, seal, aim: { scores, choice: chooseBearing(scores, yaw0) } }
}

/** The `_lavastep_mode` licence row, once per spawn (index.mjs). Pure. */
export function lavastepModeDetail (env = typeof process !== 'undefined' ? process.env : {}) {
  return `on=${lavastepOn(env) ? 1 : 0} plan_steps=${PLAN_MAX_STEPS} move_ms=${MOVE_MS} aim_cells=${AIM_CELLS} aim_ms=${AIM_MS} ` +
         `seal=${SEAL_ITEMS.join('|')} relax=${[...RELAXABLE].join('|')}:${RELAX_MS / 1000}s rollback=LAVASTEP=0`
}
