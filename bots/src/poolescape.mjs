// POOLESCAPE-01: DIG OUT OF A WALLED WATER PIT (docs/reports/poolescape-01-design-2026-10-22.md). Pure: no bot.
//
// WHY. OWNER 2026-10-22 ~17:10Z: "can the bot use their pickaxes to dig a tunnel or stairs up and out of the stranded
// pool?" Measured 10-15..10-22 (ES, 80 bots, 13,440 bot-h): 415.3 of the fleet's 419.3 bot-h in marooned-water spells
// of 30 min or more are three board-d bots, 117-160 h each, in two pits of ONE shape: a 1x1x2 hole whose feet cell is a
// water source on a solid floor, whose head cell is air, whose four head-level walls are solid blocks touching water,
// and whose column above is open. Rim 2 above the floor, water 1 deep.
//
// WHY EVERY EXISTING RUNG FAILS THERE (each guard is right alone; the composition is the dead end):
//   - pathfinder: getMoveJumpUp must break the head-level wall and `dontCreateFlow` refuses a block with water BESIDE
//     it; every move up from a liquid node returns at once ("cant jump from water"). visited=1.
//   - pillarOut / digStraightUp: a bot in 1-deep water bobs to floor+0.8 at most, so the block it places under itself
//     always overlaps its own box and the server refuses it -- 20 tries, 5 s each, every firing.
//   - the ramp: side treads are water ("no tread"), the dry-side steps touch water (overheadBreakRisk).
// THE PHYSICS THAT MAKES A WAY OUT (prismarine-physics index.js:499, vanilla): a bot in water that is HORIZONTALLY
// COLLIDED gets vel.y 0.3 when its box raised 0.6 is free -- it clears a ledge 1 above its floor, never 2. One dug or
// placed block turns the 2-high rim into a 1-high one, and the bot swims out the way a player does.
//
// THIS FILE plans ONE STEP from the bot's feet: which cells to clear, whether a tread must be placed, and every hard
// refusal. The actuator (reflex.mjs poolEscape) re-asks `poolStep` against the live world before every dig and place.
import { bodyPassable, isWaterCell, isLavaCell, isFallingBlock, isMeltingIce } from './scaffold.mjs'
import { blocked } from './protectzone.mjs'
import { routeForbids } from './keepout.mjs'
import { townDigClass } from './townground.mjs'

/** POOLESCAPE=0 turns the rung off (the one-setting rollback); anything else, or unset, leaves it on. */
export const poolEscapeOn = (env = typeof process !== 'undefined' ? process.env : {}) => String(env?.POOLESCAPE ?? '1') !== '0'
export const POOL_MAX_STEPS = 8            // steps per firing
export const POOL_BUDGET_MS = 90_000       // one firing holds the body at most this long
export const POOL_SWIM_MAX = 4             // how far it swims to another wall of the same pool
export const POOL_STEP_HOLD_MS = 2000      // phase 1: forward + jump until the feet are up (the impulse needs the collision)
export const POOL_STEP_WALK_MS = 1500      // phase 2: forward alone until the centre is inside the step cell
export const POOL_STEP_TRIES = 3           // a missed step (the cut done and dry) is pressed again, re-planned each time
export const POOL_BACKOFF_MS = [5, 10, 20, 40, 60].map(m => m * 60_000)

const SIDES = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]]
const solid = b => !!b && b.boundingBox === 'block'
/** Water now or after a swing: water in any form (waterlogged too), or ice that melts into a source (scaffold.mjs). */
const wetCell = b => isWaterCell(b) || isMeltingIce(b)
/** A cell a head can breathe in: a body fits and it is not water. */
const breathable = b => bodyPassable(b) && !isWaterCell(b)
/** A cell a block can be placed INTO: air, plain water, or a replaceable plant -- never a waterlogged block (not replaceable). */
const REPLACEABLE = /^(air|cave_air|water|flowing_water|short_grass|tall_grass|fern|large_fern|dead_bush|vine|snow|seagrass|tall_seagrass)$/
const placeableInto = b => !!b && b.isWaterlogged !== true && REPLACEABLE.test(b.name ?? '')
/** Plain water that will flow into an opened neighbour (the cells a plug is placed into). */
const flowing = b => !!b && /^(water|flowing_water)$/.test(b.name ?? '')
/**
 * A block that is USED, not built on, when clicked: mineflayer's placeBlock does not sneak, so clicking a crafting table
 * opens it and nothing is placed (Paper 10-22: board-d-Bravo's plug was aimed at the crafting table under it and "did not
 * take"). Never a reference face.
 */
export const INTERACTIVE = /(crafting_table|furnace|smoker|chest|barrel|shulker_box|hopper|dispenser|dropper|_door|trapdoor|fence_gate|_button|lever|_bed|anvil|table|composter|bell|beacon|brewing_stand|cauldron|lectern|loom|stonecutter|grindstone|jukebox|note_block|repeater|comparator|daylight_detector|_sign|flower_pot|cake|respawn_anchor|crafter|decorated_pot|chiseled_bookshelf|dragon_egg|command_block|structure_block|jigsaw|vault|trial_spawner)$/
/** The first solid, non-interactive neighbour of `c` (offsets from the feet) to click, skipping `skip` cells -> {ref, face} | null. */
function faceFor (at, c, skip = []) {
  const [cx, cy, cz] = c
  for (const [fx, fy, fz] of [[0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]]) {
    const r = [cx + fx, cy + fy, cz + fz]
    if (skip.some(k => k[0] === r[0] && k[1] === r[1] && k[2] === r[2])) continue
    const b = at(...r)
    if (solid(b) && !INTERACTIVE.test(b.name ?? '')) return { cell: c, ref: r, face: [-fx, -fy, -fz] }
  }
  return null
}

/** Is the bot WADING here: feet cell water, head cell AIR (bodyPassable alone admits water: Codex design P1)? Pure. */
export function wading ({ at = () => null } = {}) {
  const feet = at(0, 0, 0), head = at(0, 1, 0)
  if (!feet || !head) return false
  return isWaterCell(feet) && breathable(head)
}

/**
 * ONE STEP UP -> { ok, bear, place, dig, blocks, marks, wet, reason }. Pure.
 *   at(dx,dy,dz)    block relative to the bot's FEET (null = unloaded)
 *   bear {x,z}      a unit cardinal
 *   canClear(block) -> null | reason: may a hand the bot has clear it at all (the actuator passes escapeDigPlan: only
 *                   obsidian-class blocks refuse; stone without a pickaxe is SLOW, never refused -- Codex design P2)
 *   blocks          placeable blocks the bot holds (a tread, plugs, a fill each cost one)
 *   forbid(dx,dy,dz)-> null | reason: a MOVEMENT veto on a cell the body enters (keepout.mjs routeForbids: an inward
 *                   step into a live fire column; Codex design P2 -- digging as survival does not license walking in)
 *   mark(dx,dy,dz)  -> null | 'zone' | 'town': a preservation keep-out the cell lies in. An ORDERING, never a veto: these
 *                   digs are survival-class (the reflex tick's scope), and protectzone (SURVIVAL_OPS) and townground
 *                   ("a bot in a town pit digs out exactly as it does today") both let survival through
 *
 * CELLS (relative to feet): the TREAD (b,0) is stood on; the STEP (b,1) takes the feet and the HEAD (b,2) the head;
 * the CLEARANCE (b,3) is the next step's headroom (stairUpStep's third cell). The bot's own (0,2,0) and (0,3,0) are the
 * room it rises through.
 *
 * THE STEP MUST END DRY, AND THAT IS THE PHYSICS, NOT A PREFERENCE (prismarine-physics index.js:461-463, 499): the
 * out-of-liquid impulse fires only when the bot's box raised 0.6 touches NO block AND NO WATER. A step cell with water
 * in it can never be stepped into from 1-deep water. So water beside the step cell is PLUGGED first -- a block placed
 * into each plain-water face of (b,1) -- and water already in (b,1) is FILLED and dug out again; then the cut stays dry
 * and the step is an ordinary 1-high ledge. A waterlogged block beside it cannot be plugged: refused.
 * THE BREATHING COLUMN (Codex design P1): (b,2), (b,3), (0,2,0) and (0,3,0) are not water, and nothing wet touches the
 * head cells except from below. Lava on any face of any cell the step works refuses.
 *
 * Execution order (the actuator): place the tread, the plugs, the fill; dig top down (b,3), (b,2), (b,1); step.
 */
export function poolStep ({ at = () => null, bear = { x: 0, z: 0 }, canClear = () => null, blocks = 0,
                            forbid = () => null, mark = () => null } = {}) {
  const bx = bear?.x ?? 0, bz = bear?.z ?? 0
  const no = reason => ({ ok: false, bear, place: [], dig: [], blocks: 0, marks: {}, wet: 0, reason })
  if (!bx && !bz) return no('no bearing')
  const own0 = at(0, -1, 0), own1 = at(0, 1, 0), own2 = at(0, 2, 0), own3 = at(0, 3, 0)
  if (!own0 || !own1 || !own2 || !own3) return no('terrain not loaded')
  // A FLOOR UNDER THE FEET (Codex code r1 P1): the rung stands the bot on it while it works, without the float hold. A bot
  // afloat over deep water is not this trap -- it is swimming -- and is left to the float and the pathfinder.
  if (!solid(own0)) return no(`no floor under the feet (${own0.name})`)
  // THE BOT'S OWN HEAD CELL, ON EVERY PLAN (Claude code r1 P1-2): water that reached it stops the rung at the next re-plan.
  if (!breathable(own1)) return no(`the head is under water (${own1.name})`)
  // THE ROOM THE BOT RISES THROUGH, and the column it breathes in while it works.
  if (!breathable(own2)) return no(`no headroom (${own2.name})`)
  if (!breathable(own3)) return no(`no room to rise out of the water (${own3.name})`)
  const T = [bx, 0, bz], S = [bx, 1, bz], H = [bx, 2, bz], C = [bx, 3, bz]
  const tread = at(...T), step = at(...S), head = at(...H), clr = at(...C), over = at(bx, 4, bz)
  if (!tread || !step || !head || !clr || !over) return no('terrain not loaded')
  // LAVA, EVERY CELL THE STEP WORKS AND EVERY FACE OF THEM.
  for (const [c, b] of [[T, tread], [S, step], [H, head], [C, clr]]) {
    if (isLavaCell(b)) return no(`lava in the step (${c.join(',')})`)
    for (const [nx, ny, nz] of SIDES) {
      const n = at(c[0] + nx, c[1] + ny, c[2] + nz)
      if (!n) return no('terrain not loaded')
      if (isLavaCell(n)) return no(`lava against the step (${c[0] + nx},${c[1] + ny},${c[2] + nz})`)
    }
  }
  // THE MOVEMENT VETO: the body enters (b,1) and (b,2).
  for (const c of [S, H]) {
    const why = forbid(...c)
    if (why) return no(`forbidden: ${why}`)
  }
  // THE BREATHING COLUMN: (b,2) and (b,3) are not water, and nothing wet touches them except from below.
  for (const [c, b] of [[H, head], [C, clr]]) {
    if (wetCell(b)) return no(`water where the head goes (${b.name})`)
    for (const [nx, ny, nz] of SIDES) {
      if (ny === -1) continue
      const n = at(c[0] + nx, c[1] + ny, c[2] + nz)
      if (wetCell(n)) return no(`water beside the head cells (${n.name})`)
    }
  }
  if (isFallingBlock(over) && !bodyPassable(clr)) return no(`a falling block on the cut (${over.name})`)
  const place = []
  // 1. THE TREAD: solid, or placed against a face the bot can click (below first; the wall above it, while still solid).
  if (!solid(tread)) {
    if (!placeableInto(tread)) return no(`no tread (${tread.name})`)
    const f = faceFor(at, T, [[0, 0, 0]])
    if (!f) return no('no face to place the tread against')
    place.push({ ...f, why: 'tread' })
  }
  // 2. THE PLUGS: every plain-water side of the step cell (not the bot's own head cell, which is air by `wading`).
  const sides = bx ? [[bx, 1, 1], [bx, 1, -1], [2 * bx, 1, 0]] : [[1, 1, bz], [-1, 1, bz], [0, 1, 2 * bz]]
  for (const c of sides) {
    const n = at(...c)
    if (!n) return no('terrain not loaded')
    if (n.isWaterlogged === true) return no(`a waterlogged block beside the step cannot be plugged (${n.name})`)
    if (isWaterCell(n) && !flowing(n)) return no(`a water plant beside the step cannot be plugged (${n.name})`)
    if (!flowing(n)) continue
    const f = faceFor(at, c, [S, [0, 1, 0], [0, 0, 0]].concat(solid(step) ? [] : [S]))
    // the step cell itself is a fine face while it is still solid (the plug goes in before the cut)
    const g = f ?? (solid(step) && !INTERACTIVE.test(step.name ?? '') ? { cell: c, ref: S, face: [c[0] - S[0], c[1] - S[1], c[2] - S[2]] } : null)
    if (!g) return no('no face to plug the water beside the step')
    place.push({ ...g, why: 'plug' })
  }
  // 3. THE FILL: water already in the step cell is replaced by a block (clicked on the tread's top) and dug out again.
  let fill = false
  if (flowing(step)) {
    // the tread's top, or whatever is placed there first (a placed tread is a scaffold block, never interactive)
    if (solid(tread) && INTERACTIVE.test(tread.name ?? '')) return no(`the tread cannot be clicked (${tread.name})`)
    place.push({ cell: S, ref: T, face: [0, 1, 0], why: 'fill' }); fill = true
  }
  else if (step.isWaterlogged === true) return no(`a waterlogged block in the step (${step.name})`)
  else if (isWaterCell(step)) return no(`a water plant in the step (${step.name})`)   // kelp, seagrass, bubble column: wet, not fillable
  if (place.length > blocks) return no(`needs ${place.length} block(s) to place, holds ${blocks}`)
  // 4. THE CELLS TO CLEAR, top down (a falling column then falls before the bot is under it).
  const dig = []
  for (const [c, b] of [[C, clr], [H, head], [S, step]]) {
    if (c === S && fill) { dig.push(S); continue }       // the filled block (the bot's own placeable) comes out again
    if (bodyPassable(b)) continue
    if (isFallingBlock(b) && c !== C && isFallingBlock(at(c[0], c[1] + 1, c[2]))) return no(`a falling column in the step (${b.name})`)
    const why = canClear(b)
    if (why) return no(`cannot clear ${b.name}: ${why}`)
    dig.push(c)
  }
  const marks = {}
  const touched = [...place.map(q => q.cell), ...dig, S, H]
  const seen = new Set()
  for (const c of touched) {
    const k = c.join(','); if (seen.has(k)) continue; seen.add(k)
    const m = mark(...c)
    if (m) marks[m] = (marks[m] ?? 0) + 1
  }
  const wet = place.filter(q => q.why !== 'tread').length
  return { ok: true, bear, place, dig, blocks: place.length, marks, wet, reason: null }
}

const markTotal = m => Object.values(m ?? {}).reduce((a, n) => a + n, 0)

/**
 * WHICH STEP -> the best ok candidate, or { ok:false, reasons } with every candidate's reason. Pure.
 * Ranked: fewest keep-out marks; no placement over placement; fewest digs; fewest water faces; the caller's bearing
 * order (the way the bot already faces first).
 */
export function choosePoolStep ({ at = () => null, bearings = [], ...opts } = {}) {
  const reasons = {}
  let best = null
  const key = c => [markTotal(c.marks), c.place.length, c.dig.length, c.wet]
  const better = (a, b) => { const ka = key(a), kb = key(b); for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] < kb[i]; return false }
  for (const bear of bearings) {
    const c = poolStep({ ...opts, at, bear })
    if (!c.ok) { const r = c.reason.replace(/\(.*\)/, '').replace(/:.*$/, '').trim(); reasons[r] = (reasons[r] ?? 0) + 1; continue }
    if (!best || better(c, best)) best = c
  }
  return best ?? { ok: false, reasons }
}

/**
 * SWIM TO ANOTHER WALL OF THE SAME POOL -> [[dx,dz], ...] cell offsets to swim through (the last one has an ok step),
 * or null. Pure. Breadth-first over WADING cells only (feet water, head air), at most `max` cells,
 * at the bot's own feet level: a pool wider than 1x1 is crossed the way it is -- swimming -- not dug.
 * `hasStep(dx,dz)` answers whether choosePoolStep would find an ok step from that cell (the caller re-bases `at`);
 * `safe(dx,dz)` is the transit check (no lava on any face of the feet or head cell, no fire-column veto).
 */
export function swimToWall ({ at = () => null, hasStep = () => false, safe = () => true, max = POOL_SWIM_MAX } = {}) {
  const seen = new Set(['0,0'])
  let frontier = [{ x: 0, z: 0, path: [] }]
  for (let d = 1; d <= max; d++) {
    const next = []
    for (const n of frontier) {
      for (const [sx, , sz] of SIDES.filter(s => s[1] === 0)) {
        const x = n.x + sx, z = n.z + sz, k = `${x},${z}`
        if (seen.has(k)) continue
        seen.add(k)
        if (!wading({ at: (a, b, c) => at(x + a, b, z + c) }) || !safe(x, z)) continue
        const path = [...n.path, [x, z]]
        if (hasStep(x, z)) return path
        next.push({ x, z, path })
      }
    }
    frontier = next
  }
  return null
}

/**
 * THE PRESERVATION KEEP-OUT A CELL LIES IN -> 'zone' | 'town' | null (an ordering mark). Pure. Absolute integer cell.
 *   zone  protectzone.mjs blocked() (its deep exemption included; `feet` the bot's)
 *   town  townground.mjs townDigClass() === 'ground' for the block there
 */
export function keepoutMark ({ cell, feet = null, zones = [], home = null, name = null } = {}) {
  if (!cell) return null
  if (zones?.length && blocked(zones, cell.x, cell.y, cell.z, feet)) return 'zone'
  if (home && name && townDigClass(cell, name, home) === 'ground') return 'town'
  return null
}

/** THE MOVEMENT VETO on an entered cell -> reason | null. Pure. keepout.mjs routeForbids (an inward live fire column). */
export function poolForbid ({ cell, feet = null, fireSites = [] } = {}) {
  if (!cell || !fireSites?.length) return null
  return routeForbids(fireSites, feet, cell) ? 'a live fire column (keep-out)' : null
}

/**
 * MAY THIS TOOL DIG FOR THE POOL ESCAPE, given `planned` digs with it this firing (cumulative)? Pure.
 * THE ESCAPE RESERVE IS KEPT, UNCHANGED (both design reviews): reflex.mjs mayDigForEscape never spends the bag's LAST
 * usable pickaxe on an escape, and neither does this rung -- the hand digs instead. That is slower, never a refusal
 * (escapeDigPlan: hardness decides IF, the situation decides WHICH HAND), so no dead end comes of it. Any other copy
 * may dig while it keeps more than HARD_STOP (1) use after the planned digs. Unknown durability counts as full.
 */
export function poolToolOk (tool, items = [], planned = 1) {
  if (!tool) return true
  const left = it => (it?.maxDurability ? it.maxDurability - (it.durabilityUsed ?? 0) : Infinity)
  const n = Math.max(1, planned)
  if (/_pickaxe$/.test(tool.name ?? '')) {
    const usable = (Array.isArray(items) ? items : []).filter(it => /_pickaxe$/.test(it?.name ?? '') && left(it) > 1).length
    if (usable <= 1) return false
  }
  return left(tool) - n > 1
}

/**
 * THE BLOCK TO PLACE (tread, plug, fill) -> item | null. Pure. The escape's own cheapest-first order (toolfor pickScaffold)
 * WITHOUT falling blocks (Claude code r1 P1-2): a sand plug over water reads solid when placed and then falls, and the cut
 * that follows floods the step and the bot's head cell. Never a falling block, whatever the bag holds.
 */
export function poolBlockOf (items = [], placeable = /./, pick = null) {
  const ok = (Array.isArray(items) ? items : []).filter(it => it?.name && placeable.test(it.name) && !isFallingBlock({ name: it.name }))
  return pick ? pick(ok, placeable) : (ok[0] ?? null)
}
/** How many such blocks the bag holds (the plan's `blocks`). Pure. */
export const poolBlockCount = (items = [], placeable = /./) =>
  (Array.isArray(items) ? items : []).filter(it => it?.name && placeable.test(it.name) && !isFallingBlock({ name: it.name })).reduce((a, it) => a + (it.count ?? 0), 0)

/** The `_poolescape_mode` licence row, once per spawn (index.mjs). Pure. */
export function poolEscapeModeDetail (env = typeof process !== 'undefined' ? process.env : {}) {
  return `on=${poolEscapeOn(env) ? 1 : 0} max_steps=${POOL_MAX_STEPS} budget_s=${POOL_BUDGET_MS / 1000} swim=${POOL_SWIM_MAX} ` +
    `reserve=last_pickaxe_kept backoff_min=${POOL_BACKOFF_MS.map(m => m / 60_000).join('/')}`
}

/** The back-off after a firing that did not get out: 5, 10, 20, 40, then 60 min. Pure. */
export function poolBackoffMs (failures) {
  const n = Math.max(1, Math.floor(failures || 1))
  return POOL_BACKOFF_MS[Math.min(n, POOL_BACKOFF_MS.length) - 1]
}

/** The spot key a back-off is held against: a 2-block cell, so a bot bobbing within its pit is the same spot. Pure. */
export const poolSpotKey = p => (p ? `${Math.floor(p.x / 2)},${Math.floor(p.y / 2)},${Math.floor(p.z / 2)}` : '?')

/** The `_poolescape` row's detail. Pure. */
export function poolRowDetail (r = {}) {
  const m = r.marks ?? {}
  return `outcome=${r.outcome ?? '?'} steps=${r.steps ?? 0} rose=${(r.rose ?? 0).toFixed(1)} dug=${r.dug ?? 0} placed=${r.placed ?? 0} ` +
    `swam=${r.swam ?? 0} hands=${(r.hands ?? []).join(',') || '-'} marks=zone:${m.zone ?? 0},fire:${m.fire ?? 0},town:${m.town ?? 0} ` +
    `lava_refused=${r.lavaRefused ?? 0} water_beside=${r.wet ?? 0} dry=${r.dry ? 1 : 0} route=${r.route ? 1 : 0} step_retries=${r.stepRetries ?? 0} ` +
    `at=${r.at ?? '?'} tries=${r.tries ?? 0} -- ${String(r.reason ?? '').slice(0, 160)}`
}
