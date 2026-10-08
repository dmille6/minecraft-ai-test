// AIRPOCKET (underground-safety phase 2, docs/reports/airpocket-design-2026-10-07.md): a dig step INSIDE the drowning
// rescue for a bot sealed in water under a roof.
//
// MEASURED (docs/reports/underground-safety-phase2-2026-10-07.md):
//   - every drowning in 5 days (170) was in a sealed pocket, and every POST-climbflood drowner held a pickaxe;
//   - in peaceful (every fleet world) a drowning bot lives 83-90 s after its air runs out (Paper sandbox2, server-side,
//     -0.31 HP/s steady); on `easy` 18 s;
//   - a cell dug directly above a submerged head STAYS AIR -- water does not flow upward -- so ONE dig makes a breathing
//     pocket whatever the roof's thickness, provided no liquid touches that cell and nothing can fall into it;
//   - stone over the head: 2.9 s to break standing on the floor, 14.1 s floating against it (stone pickaxe), and the
//     client's dig prediction matched the server within 0.06 s;
//   - 43 of 170 drowning sites in the saved worlds pass this module's geometry + budget screen.
// Today's rescue only holds jump; the flooded-pocket rung refuses once air is gone ("no air to start with").
//
// Everything decided here is a pure function of numbers and blocks the caller reads; `airPocketStep` is the one
// impure part (it digs), and it is driven by the same pure checks so a fake bot can test it.

export const AP_RESERVE_HP = 4               // never plan to spend the last 4 HP
export const AP_ENVELOPE_PEACEFUL = 0.5      // HP/s: sandbox worst steady 0.32; worst 20-s window 0.42
export const AP_ENVELOPE_DEFAULT = 2.0       // HP/s: vanilla drowning with no healing -- an upper bound on any world
export const AP_MARGIN = 1.5                 // the dig prediction is multiplied by this
export const AP_LATENCY_MS = 3000            // equip + server confirm + the rise into the pocket
export const AP_BREACH_WINDOW_MS = 10_000    // the envelope is judged over 10 s: damage arrives in 2-HP steps
export const AP_BREACH_HP = 7                // > 7 HP in 10 s is a breach (sandbox peaceful max 5.0 in 10 s)
export const AP_CONFIRM_MS = 2500            // the eye must stay in air this long, with NO health drop (airpocket-02)
export const AP_RISE_MS = 4000               // after the dig, the eye has this long to reach air
export const AP_TRIGGER_AFTER_MS = 8000      // a non-sealed, capped rescue gets this long to work before the dig
export const AP_FAIL_COOLDOWN_MS = 60_000    // a failed or aborted step is not retried here for a minute
export const AP_REFUSE_COOLDOWN_MS = 5000    // a refused plan is re-planned at most this often (it is cheap)
export const AP_ICE_ENABLED = true             // the ice branch (break, then rise one cell); off if sandbox scene F fails
export const AP_EQUIP_MS = 1500               // equip is bounded too (Codex r1): it runs before the dig's deadline
export const AP_NOT_CLOSING_MS = 4000         // a non-sealed rescue must have stopped closing on air this long
export const AP_WANT_LAPSE_MS = 3000          // a pre-empt request lapses unless renewed (it is renewed every tick)
export const AP_BREATHE_HOLD_MS = 10_000      // after a pocket opens, no escape starts for 10 s (air refills to 300 in ~4 s)
export const AP_REDIG_MAX = 2                 // a dug cell that re-freezes is dug again at most this often in one step
export const AP_WINDOW_WAIT_MS = 1500         // an open container window gets this long to close before any equip
export const AP_WINDOW_SETTLE_MS = 250        // and this long after it closes, for the closing skill's last clicks

import { difficultyOf } from './foodskip.mjs'
import { TOOL_HYGIENE, remaining, HARD_STOP } from './toolfor.mjs'

const WATERLIKE = /^(water|flowing_water|bubble_column|kelp|kelp_plant|seagrass|tall_seagrass)$/
const LAVALIKE = /lava|^magma_block$|^fire$|^soul_fire$/
const FALLING = /^(sand|red_sand|gravel|suspicious_sand|suspicious_gravel|anvil|chipped_anvil|damaged_anvil|pointed_dripstone|dragon_egg|scaffolding)$|concrete_powder$/
const NO_DIG = /^(bedrock|barrier|end_portal_frame|command_block|structure_block|jigsaw|reinforced_deepslate|spawner|trial_spawner|vault|chest|trapped_chest|barrel|ender_chest|furnace|blast_furnace|smoker|composter|crafting_table)$|shulker_box$/
// A STAND NEVER PLACES AGAINST THESE (both r7 reviews): a place on a container, workstation, door, trapdoor, gate,
// button, lever, bed or sign opens or toggles it instead of placing -- and a door or trapdoor could let water in.
const INTERACTIVE = /(door|trapdoor|fence_gate|_button|_bed|_sign|_hanging_sign|anvil|shulker_box)$|^(lever|chest|trapped_chest|ender_chest|barrel|furnace|blast_furnace|smoker|crafting_table|enchanting_table|brewing_stand|beacon|hopper|dispenser|dropper|lectern|loom|stonecutter|grindstone|smithing_table|cartography_table|fletching_table|bell|note_block|jukebox|respawn_anchor|composter|cauldron|water_cauldron|lava_cauldron|powder_snow_cauldron|repeater|comparator|daylight_detector|command_block|structure_block|jigsaw|spawner|trial_spawner|vault|crafter|decorated_pot|chiseled_bookshelf)$/
const ICE = /^(ice|frosted_ice)$/            // breaks into WATER over water; packed/blue ice do not and take the pocket rule
const AIRLIKE = /^(air|cave_air|void_air)$/
// THE TOWN JUNK WELL'S MARKER (junkwell-02, well.mjs wellIdentity: "towns have no other trapdoors"): a top-half cap at
// g, a bottom-half floor trapdoor at g-1, solid floor at g-2. A drowning bot in a flooded column under that floor would
// dig the floor and open the shaft (both reviews of junkwell-02). The rescue never digs a trapdoor or a cell with one
// within two above it.
const WELL_MARK = /_trapdoor$/

function waterlogged (b) {
  try {
    const p = typeof b?.getProperties === 'function' ? b.getProperties() : (b?._properties ?? b?.properties)
    return p?.waterlogged === true || p?.waterlogged === 'true'
  } catch { return false }
}
const isWater = b => !!b && (WATERLIKE.test(b.name || '') || waterlogged(b))
const isLiquid = b => !!b && (isWater(b) || LAVALIKE.test(b.name || ''))
const isAir = b => !!b && AIRLIKE.test(b.name || '')
const isSolid = b => !!b && b.boundingBox === 'block'

/**
 * WHICH CELL, IF ANY, BECOMES A BREATHING POCKET? Pure.
 *
 * `at(dx, dy, dz)` -> block (or null = unknown) relative to the bot's FEET cell. Head = (0,1,0).
 * The first non-water cell above the head must be at dy 2 or 3 (within 2 cells of the head) and be either
 *   - POCKET: solid, diggable, not a falling block, with no liquid / falling block / unknown on its four sides or
 *     above it, so the dug cell stays air; or
 *   - ICE:    plain ice with AIR directly above it (breaking it opens a water column one cell from the air).
 * @returns {{ ok: boolean, why: string|null, kind: 'pocket'|'ice'|null, dy: number|null, name: string|null }}
 */
export function airPocketPlan (at, { pose = 'stand', feetSupport = false } = {}) {
  const refuse = (why, extra = {}) => ({ ok: false, why, kind: null, dy: null, name: null, ...extra })
  const feet = at(0, 0, 0), head = at(0, 1, 0)
  if (feet == null || head == null) return refuse('own cells unknown')
  if (!isWater(head)) return refuse(`head cell is ${head.name}, not water`)
  // a crouching or swimming bot occupies only its eye's cell: the cell under it may be the floor (a 1-tall gap under
  // ice: airpocket-02, Paper scene S1)
  // a standing bot ON a partial block in its feet cell (a slab: standsOn) is above it -- Codex r1 P2
  if (pose === 'stand' && !feetSupport && !isWater(feet) && !isAir(feet)) return refuse(`feet cell is ${feet.name}`)
  for (const dy of [2, 3]) {
    const b = at(0, dy, 0)
    if (b == null) return refuse(`cell +${dy} unknown`)
    if (isWater(b)) { if (dy === 3) return refuse('water continues above the head (no roof within 2)'); continue }
    if (isAir(b)) return refuse('air above: the rescue swims, nothing to dig')
    if (LAVALIKE.test(b.name)) return refuse(`${b.name} above the head`, { dy, name: b.name })
    if (FALLING.test(b.name)) return refuse(`${b.name} above would fall`, { dy, name: b.name })
    if (ICE.test(b.name)) {
      if (!AP_ICE_ENABLED) return refuse('ice branch disabled', { dy, name: b.name })
      const top = at(0, dy + 1, 0)
      if (top == null) return refuse('above the ice unknown', { dy, name: b.name })
      if (!isAir(top)) return refuse(`ice with ${top.name} above, not air`, { dy, name: b.name })
      // the well-floor guard applies to ice too (Codex r1 P2)
      const itop2 = at(0, dy + 2, 0)
      if (itop2 == null) return refuse('two above the ice unknown', { dy, name: b.name })
      if (WELL_MARK.test(itop2.name)) return refuse(`a well block (${itop2.name}) above the ice`, { dy, name: b.name })
      return { ok: true, why: null, kind: 'ice', dy, name: b.name }
    }
    if (WELL_MARK.test(b.name)) return refuse(`${b.name} is a well block`, { dy, name: b.name })
    if (!isSolid(b)) return refuse(`${b.name} is not a full block`, { dy, name: b.name })
    if (NO_DIG.test(b.name)) return refuse(`${b.name} is not dug`, { dy, name: b.name })
    const around = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => at(dx, dy, dz))
    const top = at(0, dy + 1, 0)
    if (around.some(s => s == null) || top == null) return refuse('a neighbour of the roof cell is unknown', { dy, name: b.name })
    const wet = around.find(isLiquid)
    if (wet) return refuse(`${wet.name} beside the roof cell would fill the pocket`, { dy, name: b.name })
    if (isLiquid(top)) return refuse(`${top.name} above the roof cell would fill the pocket`, { dy, name: b.name })
    if (FALLING.test(top.name)) return refuse(`${top.name} above the roof cell would fall in`, { dy, name: b.name })
    // THE WELL-FLOOR GUARD (airpocket-02): never open into a junk well's shaft from below
    const top2 = at(0, dy + 2, 0)
    if (top2 == null) return refuse('two above the roof cell unknown', { dy, name: b.name })
    if (WELL_MARK.test(top.name) || WELL_MARK.test(top2.name)) return refuse(`a well block (${WELL_MARK.test(top.name) ? top.name : top2.name}) above the roof cell`, { dy, name: b.name })
    return { ok: true, why: null, kind: 'pocket', dy, name: b.name }
  }
  return refuse('no roof within 2 of the head')
}

/** The damage envelope in HP/s: 0.5 only on a peaceful world with no Hunger effect, else 2.0. Pure. */
export function airPocketEnvelope ({ difficulty = null, hungerActive = false } = {}) {
  return difficulty === 'peaceful' && !hungerActive ? AP_ENVELOPE_PEACEFUL : AP_ENVELOPE_DEFAULT
}

/** Milliseconds of digging the health budget allows from here: (health - reserve) / envelope. Pure. */
export function airPocketBudgetMs ({ health, envelope }) {
  if (!(typeof health === 'number') || !(envelope > 0)) return 0
  return Math.max(0, health - AP_RESERVE_HP) / envelope * 1000
}

/**
 * MAY THE STEP START? Pure. `digMs` is the client's prediction for the chosen tool in the bot's situation
 * (predictedDigMs with digEnv: in water, off the ground). Required = digMs x 1.5 + 3 s.
 */
export function airPocketAdmit ({ health, difficulty, hungerActive = false, digMs }) {
  const envelope = airPocketEnvelope({ difficulty, hungerActive })
  if (!(Number.isFinite(digMs) && digMs > 0)) return { ok: false, why: 'dig time unknown', envelope, requiredMs: null, budgetMs: null }
  const requiredMs = digMs * AP_MARGIN + AP_LATENCY_MS
  const budgetMs = airPocketBudgetMs({ health, envelope })
  const ok = requiredMs <= budgetMs
  return { ok, why: ok ? null : `needs ${Math.round(requiredMs)} ms, budget ${Math.round(budgetMs)} ms (health ${health}, ${envelope} HP/s)`, envelope, requiredMs, budgetMs }
}

/** Was the envelope breached? `samples` = [{t, hp}] oldest first. More than 7 HP lost within the last 10 s. Pure. */
export function envelopeBreached (samples = [], now = Date.now()) {
  const recent = samples.filter(s => now - s.t <= AP_BREACH_WINDOW_MS && typeof s.hp === 'number')
  if (recent.length < 2) return false
  const last = recent[recent.length - 1].hp
  const peak = Math.max(...recent.map(s => s.hp))
  return peak - last > AP_BREACH_HP
}

/**
 * BREATHING, CONFIRMED? Pure. SERVER-GROUNDED (airpocket-02; Paper freeze-probe trial 2): airpocket-01 asked for the eye
 * in air (the client's STANDING eye) and health "rising", and logged a success for a bot the server had in swimming pose
 * with its eye in water: health flickered 18 <-> 20 and one rise passed. Health is the server's number; a drowning bot is
 * hit every ~1 s (Paper peaceful: median 1.0 s between hits, 1 gap above 2 s in 261). So: the POSE-AWARE eye
 * (`poseEye`) in air for >= AP_CONFIRM_MS (2.5 s) AND no health drop between any two samples since the eye got there
 * AND (as in airpocket-01) health rose in that time or is at its maximum: flat health below the maximum is a drowning
 * bot whose air has not run out yet (sandbox: ~15 s of flat health), not a breathing one.
 * `samples` = [{t, hp}] oldest first.
 */
export function airPocketConfirmed ({ eyeInAirSince = null, now = Date.now(), samples = [], maxHealth = 20 }) {
  if (eyeInAirSince == null || now - eyeInAirSince < AP_CONFIRM_MS) return false
  const since = samples.filter(s => s.t >= eyeInAirSince && typeof s.hp === 'number')
  if (since.length < 2) return false
  for (let i = 1; i < since.length; i++) if (since[i].hp < since[i - 1].hp) return false
  const first = since[0].hp, last = since[since.length - 1].hp
  return last > first || last >= maxHealth
}

/**
 * WHERE IS THE EYE? Pure. Vanilla puts a player whose standing box (1.8) does not fit into the crouching box (1.5, eye
 * 1.27), and when that does not fit either, into the swimming box (0.6, eye 0.4). mineflayer has no pose model and
 * always assumes 1.62. Paper freeze-probe trial 2 (10-08): ice re-formed over a floating bot; server and client both
 * held y 121.395 (= 122 - 0.605: the swimming box against the ice), the client's +1.62 eye read AIR while the server's
 * Air stayed <= 0 for 80 s -- the hive-d signature (y 61.4, head cell ice, 23 drownings since 10-01).
 * `solidAt(cellY)` -> true when the cell in the bot's column at that y blocks the body.
 * @returns {{ pose: 'stand'|'crouch'|'swim', eyeY: number, eyeCell: number }}
 */
export const POSES = Object.freeze([['stand', 1.8, 1.62], ['crouch', 1.5, 1.27], ['swim', 0.6, 0.4]])
export function poseEye ({ y, solidAt = () => false, collides = null }) {
  for (const [pose, h, eye] of POSES) {
    let fits = true
    if (typeof collides === 'function') {
      // the real test (Codex r1 P2): any collision shape in the body's footprint across the box's span above the feet
      fits = !collides(y + 1e-6, y + h - 1e-6)
    } else {
      // whole cells in the bot's column ABOVE the feet cell (the feet cell holds the bot already)
      for (let c = Math.floor(y) + 1; c <= Math.floor(y + h - 1e-6); c++) if (solidAt(c)) { fits = false; break }
    }
    if (fits || pose === 'swim') return { pose, eyeY: y + eye, eyeCell: Math.floor(y + eye) }
  }
}

/**
 * DOES ANY BLOCK'S COLLISION SHAPE INTERSECT THE BODY'S BOX between y0 and y1? Pure over blockAt. The footprint is the
 * player's 0.6 x 0.6 around (px, pz); a block's `shapes` ([x0,y0,z0,x1,y1,z1] in the cell) decide, else a 'block'
 * bounding box is a full cube. Water, air and plants (no shapes) never collide.
 */
export function boxCollides ({ px, pz, y0, y1, blockAt, Vec3 }) {
  const xs = [Math.floor(px - 0.3 + 1e-6), Math.floor(px + 0.3 - 1e-6)], zs = [Math.floor(pz - 0.3 + 1e-6), Math.floor(pz + 0.3 - 1e-6)]
  for (let cx = xs[0]; cx <= xs[1]; cx++) {
    for (let cz = zs[0]; cz <= zs[1]; cz++) {
      for (let cy = Math.floor(y0); cy <= Math.floor(y1); cy++) {
        const b = blockAt(new Vec3(cx, cy, cz))
        if (!b) continue
        const shapes = Array.isArray(b.shapes) ? b.shapes : (b.boundingBox === 'block' ? [[0, 0, 0, 1, 1, 1]] : [])
        for (const [sx0, sy0, sz0, sx1, sy1, sz1] of shapes) {
          if (cx + sx1 <= px - 0.3 || cx + sx0 >= px + 0.3 || cz + sz1 <= pz - 0.3 || cz + sz0 >= pz + 0.3) continue
          if (cy + sy1 > y0 && cy + sy0 < y1) return true
        }
      }
    }
  }
  return false
}

/** Is the bot standing ON the block in its feet cell (a slab, a carpet), i.e. is that block's top at or under its feet? Pure. */
export function standsOn ({ y, block }) {
  if (!block || !isSolid(block)) return false
  const shapes = Array.isArray(block.shapes) ? block.shapes : [[0, 0, 0, 1, 1, 1]]
  if (!shapes.length) return false
  const top = Math.max(...shapes.map(sh => sh[4]))
  return Math.floor(y) + top <= y + 1e-6 && top < 1
}

/**
 * THE PLAN'S FEET CELL. Pure. Standing: the feet cell, as airpocket-01 planned. Crouching or swimming: the cell under
 * the EYE's cell, so the plan's "head" is where the eye really is (trial 2: eye cell 121, the ice at 122 = dy 2).
 */
export function planBaseY ({ y, pose, eyeY }) {
  return pose === 'stand' ? Math.floor(y) : Math.floor(eyeY) - 1
}

/**
 * IS THE RESCUE'S `up` ROUTE BLOCKED? Pure. reflex.mjs scanBreathableRoute starts ONE CELL ABOVE the head cell
 * (pos + 1), so a solid head cell -- ice formed around a swimming bot -- reads `up dist=1` to the air beyond it, and the
 * rescue holds jump into the ice for four ceilings (hive-d-Alpha 07:45Z and 14:08Z 10-08). Every cell strictly between
 * the eye cell and the route's air cell must be passable; the first that is not is returned. An unknown (null) cell
 * makes the answer NOT blocked (Codex r1: an unread cell is no evidence, and C7 demands a named solid block).
 * `cellAt(y)` -> block in the bot's column.
 * @returns {{ blocked: boolean, by: {name: string, y: number}|null }}
 */
export function routeUpBlocked ({ routeDir, targetY, eyeCell, cellAt = () => null }) {
  if (routeDir !== 'up' || !Number.isFinite(targetY) || !Number.isFinite(eyeCell)) return { blocked: false, by: null }
  for (let y = eyeCell + 1; y < targetY; y++) {
    const b = cellAt(y)
    if (b == null) return { blocked: false, by: null }          // an unread cell proves nothing: never on a guess
    if (isSolid(b)) return { blocked: true, by: { name: b.name, y } }
  }
  return { blocked: false, by: null }
}

/**
 * MAY THE STEP TOUCH THE INVENTORY? Pure. The window-handoff race (peacefulkit-01 review r1/r2, Codex): the rescue
 * interrupts a skill and equips at once, but an interrupted smelt/chest/craft may still hold a container window open
 * and be clicking (smelt's drain: up to 12 s). An equip then clicks the WRONG window's slots. So no equip while a
 * window is open: wait up to AP_WINDOW_WAIT_MS for it to close (never a forced close -- the old transfers could still
 * resume), then AP_WINDOW_SETTLE_MS more; a window still open -> 'skip' (no inventory click; the step prices what is held).
 */
export function windowHandoff ({ open, waitedMs, closedForMs = Infinity }) {
  if (open) return waitedMs >= AP_WINDOW_WAIT_MS ? 'skip' : 'wait'
  return closedForMs >= AP_WINDOW_SETTLE_MS ? 'go' : 'wait'
}

/** Await the handoff. Impure (reads bot.currentWindow, sleeps). -> 'none' (no window seen) | 'closed' | 'open'. */
export async function awaitWindowHandoff (bot, { sleep, now }) {
  const t0 = now()
  if (!bot.currentWindow) return 'none'
  let closedAt = null
  while (true) {
    const open = !!bot.currentWindow
    if (!open && closedAt == null) closedAt = now()
    const d = windowHandoff({ open, waitedMs: now() - t0, closedForMs: closedAt == null ? 0 : now() - closedAt })
    if (d === 'go') return 'closed'
    if (d === 'skip') return 'open'
    if (open) closedAt = null
    await sleep(50)
  }
}


/**
 * SHOULD THE RESCUE TRY THE STEP THIS TICK? Pure. Only while rescuing, never with an UP route (the swim works),
 * at once when the rescue's own scan says SEALED, otherwise after 8 s of a capped rescue (an `out` or unscanned
 * route gets its chance first), and not during a cooldown or while the step already runs.
 */
export function airPocketTrigger ({ rescuing, routeDir, routeSealed, heldMs, active = false, now = Date.now(), cooldownUntil = 0,
                                    othersBusy = false, msSinceClosing = Infinity }) {
  // NOTHING ELSE IN FLIGHT (Codex r1): an escape, the flooded-pocket rung or a maroon climb awaited by an earlier tick
  // can resume after its await and steer; the early return only stops NEW ticks. So the step starts only when none is.
  if (!rescuing || active || othersBusy || now < cooldownUntil) return false
  if (routeDir === 'up') return false
  // NOT WHILE A SWIM IS WORKING (Claude r1: 4 of 46 out/unscanned rescues reached air between 8 and 20 s): a non-sealed
  // capped rescue must ALSO have stopped closing on air for 4 s.
  return routeSealed === true || (heldMs >= AP_TRIGGER_AFTER_MS && msSinceClosing >= AP_NOT_CLOSING_MS)
}

/**
 * SHOULD THE STEP PRE-EMPT AN IN-FLIGHT ESCAPE? Pure. Paper sandbox, 10-07 (cand A, 8c2c7f9 and 569e236): in a sealed
 * hive-c column the entombed escape (pillarOut -> digStraightUp) dug the roof BARE-HANDED and floating -- 37.5 s against
 * its 8-15 s dig budget -- failed, and re-started, holding `escaping` for ~58 s; the trigger's busy guard waited, and the
 * budget ran out (one trial refused at 15.3 HP and drowned like the control; one admitted by 517 ms and lived). Two
 * correct guards composed into a dead end. So inside a SEALED rescue (the scan proves no swim), an escape or maroon
 * climb is told to yield (its `alive` turns false, its current dig is stopped) and the step runs on the next tick. The
 * flooded-pocket rung is never pre-empted (it is a rescue of its own).
 */
export function airPocketPreempt ({ rescuing, routeDir, routeSealed, escaping = false, marooned = false, pocketing = false,
                                    active = false, now = Date.now(), cooldownUntil = 0, stepWouldRun = () => false,
                                    heldMs = 0, msSinceClosing = 0 }) {
  if (!rescuing || active || pocketing || now < cooldownUntil) return false
  // SEALED, or an `up` route proven blocked (routeUpBlocked) that has had the trigger's own 8 s and is not closing on
  // air (airpocket-02: hive-d-Alpha 07:43Z, the maroon climb started 7 s before the rescue and looped for 90 s)
  const blockedLong = routeDir === 'upblocked' && heldMs >= AP_TRIGGER_AFTER_MS && msSinceClosing >= AP_NOT_CLOSING_MS
  if (!blockedLong && (routeDir === 'up' || routeDir === 'upblocked' || routeSealed !== true)) return false
  if (!(escaping || marooned)) return false
  // ONLY FOR A STEP THAT WOULD RUN (both reviews r2): an escape is never stopped for a step that then refuses. Asked
  // last, because it reads blocks (plan + admission, no side effects).
  return stepWouldRun() === true
}

const DIG_TOOL = /_(pickaxe|shovel|axe)$/
/**
 * THE DIG CANDIDATES -- ONE list for the admission/pre-empt price (reflex.mjs prepareAirPocket) and the step, so the two
 * can never disagree (a pre-empt admitted on a copy the step then skips would be a dead end).
 * TOOL HYGIENE (toolhygiene-01 on the airpocket base; rebase reviews 10-08, Codex P1 + Claude P2): hygiene drains worn
 * copies to 1 use, and a copy the server already broke still shows at 1 use for > 1.5 s (toolfor.mjs HARD_STOP); dug
 * with, the server digs bare-handed while the client priced the pickaxe -> ghost air, a failed rescue. So with hygiene ON,
 * a copy at <= HARD_STOP is dropped when the bag holds a copy of the SAME kind above it (pocketPlanFor's rule); with no
 * such copy it stays (a real 1-use copy still digs once). Hygiene OFF: every tool, exactly as airpocket-01 deployed.
 */
export function airPocketTools (items = [], { hygiene = TOOL_HYGIENE.on } = {}) {
  const all = (Array.isArray(items) ? items : []).filter(it => DIG_TOOL.test(it?.name ?? ''))
  if (!hygiene) return all
  const kind = it => it.name.match(DIG_TOOL)[1]
  const healthy = new Set(all.filter(it => remaining(it) > HARD_STOP).map(kind))
  return all.filter(it => remaining(it) > HARD_STOP || !healthy.has(kind(it)))
}

/** The fastest of the candidate items (null = the hand) by the caller's prediction. Pure. */
export function pickFastestTool (candidates = [], predict = () => null) {
  let best = null
  for (const item of [null, ...candidates]) {
    const ms = predict(item)
    if (Number.isFinite(ms) && ms > 0 && (!best || ms < best.ms)) best = { item, ms }
  }
  return best
}

/**
 * THE WORLD'S INPUTS TO ADMISSION, read the way this codebase must read them. Pure over a bot-shaped object.
 *   difficulty: foodskip.mjs difficultyOf -- the server's `difficulty` packet as recorded on bot.serverDifficulty, because
 *               mineflayer's bot.game.difficulty is ALWAYS undefined on 1.21.8 (found by the airpocket sandbox pilot 10-07:
 *               every refusal said difficulty=undefined and the 2.0 envelope refused every stone dig on a peaceful world).
 *   hungerActive: the Hunger effect, resolved through the registry by name case-insensitively (minecraft-data 1.21.8
 *               names it `Hunger`, id 16; Codex r1: a lookup of `hunger` misses it), against bot.entity.effects (keyed
 *               by id, each {id, amplifier, duration}).
 */
export function airPocketInputs (bot) {
  const byName = bot?.registry?.effectsByName ?? {}
  const key = Object.keys(byName).find(k => k.toLowerCase() === 'hunger')
  const id = key != null ? byName[key]?.id : null
  const effects = bot?.entity?.effects ?? {}
  const hungerActive = id != null && (effects[id] != null || Object.values(effects).some(e => e?.id === id))
  return { difficulty: difficultyOf(bot), hungerActive }
}

/**
 * THE RESCUE'S STATE AFTER A STEP. Pure. Success: the place now HAS air, so the fail memory is cleared and the rescue's
 * ceiling and progress clocks restart (a bot that sinks back is lifted by the ordinary `up dist=1` route; a stale fail
 * memory would otherwise suppress the rescue right there). Failure or abort: a 60-s cooldown here, the memory kept.
 */
export function airPocketAfter (ok, state, now = Date.now(), { refrozen = false } = {}) {
  // `ok` is true for a success AND for an OPENED pocket: either way the place now has air.
  // BREATHE FIRST (Paper sandbox bf99227/aca3063 A): ~2 s after success the entombed escape fired, its pillar seized the
  // body and released the float, and the bot sank with Air at 46-58 of 300 (~2 s of breath) until the rescue lifted it.
  // So escapes and maroon climbs do not start until AP_BREATHE_HOLD_MS after the pocket opens.
  if (ok) return { ...state, drownFails: 0, drownFailPos: null, drownFailHealth: null, seizedAt: now, lastProgressAt: now, breatheUntil: now + AP_BREATHE_HOLD_MS }
  // a cell that re-formed is dug again at the next trigger, seconds later (Codex r1 P1: an executable recovery)
  return { ...state, cooldownUntil: now + (refrozen ? AP_REFUSE_COOLDOWN_MS : AP_FAIL_COOLDOWN_MS) }
}

/**
 * THE STEP. Impure: digs the planned cell and confirms breathing. The caller holds the body (the air reflex's grant)
 * and keeps every other tick out while this runs. Returns {ok, outcome, why, ...} and never throws.
 *   deps.blockAt(vec) / deps.Vec3 / deps.predict(block, item) -> ms / deps.sleep(ms) / deps.now()
 */
export async function airPocketStep (bot, plan, { Vec3, predict, sleep = ms => new Promise(r => setTimeout(r, ms)),
                                                 now = () => Date.now(), maxHealth = 20, envelope, guard = () => null,
                                                 standItem = () => null } = {}) {
  const t0 = now()
  const p0 = bot.entity.position
  // the plan's feet cell: the caller's pose-aware base (planBaseY) when it gave one, else the feet cell (airpocket-01)
  const fx = Math.floor(p0.x), fy = Number.isFinite(plan.baseY) ? plan.baseY : Math.floor(p0.y), fz = Math.floor(p0.z)
  const cellPos = new Vec3(fx, fy + plan.dy, fz)
  const samples = []
  const sample = () => { samples.push({ t: now(), hp: bot.health }) }
  // EVERY HEALTH UPDATE, not only the 250-ms poll (Codex r1 P2: a hit and a heal between two polls would be missed)
  const onHealth = () => sample()
  try { bot.on?.('health', onHealth) } catch { /* a fake */ }
  const healthStart = bot.health
  const res = { ok: false, outcome: 'failed', why: null, kind: plan.kind, cell: `${fx},${fy + plan.dy},${fz}`, block: plan.name,
                tool: 'hand', predictedMs: null, digMs: null, healthStart, healthEnd: null, eye: null, envelope }
  const budgetLeft = () => airPocketBudgetMs({ health: bot.health, envelope }) - (AP_LATENCY_MS / 2)
  let aborted = null
  let watch = null
  let digging = false
  try {
    const block = bot.blockAt(cellPos)
    if (!block || block.name !== plan.name) { res.why = `roof cell changed to ${block?.name ?? 'unknown'}`; return res }
    const items = airPocketTools(bot.inventory?.items?.() ?? [])
    const best = pickFastestTool(items, item => predict(block, item))
    if (!best) { res.why = 'no dig time for any tool'; return res }
    // HORIZONTAL CONTROLS OFF FIRST (Codex r1): an `out` rescue may have been holding forward; the dig turns the head, so a
    // held forward would carry the bot off the planned column.
    // JUMP ONLY WHEN ALREADY FLOATING (Claude r1): a bot standing on the pocket floor that holds jump lifts off it, and an
    // off-ground dig is 5x slower than the on-ground time mineflayer priced at the call -- the client would then send
    // "finished" early, the server would refuse, and the client would show ghost air. So a standing bot digs standing
    // (2.9 s, sandbox) and holds jump only for the rise; a floating bot holds jump against the roof throughout.
    for (const c of ['forward', 'back', 'left', 'right', 'sprint', 'sneak']) { try { bot.setControlState(c, false) } catch {} }
    const standing = bot.entity?.onGround === true
    // THE STEP OWNS JUMP AND RE-ASSERTS IT EVERY WATCH TICK (Paper sandbox 10-07, 5b6c530: the floating bot sank 3 blocks
    // during the dig -- something else, likely the pre-empted escape unwinding, cleared the controls).
    let wantJump = !standing
    try { bot.setControlState('jump', wantJump) } catch { /* not connected */ }
    res.standing = standing
    // BOUNDED EQUIP, THEN VERIFY WHAT IS ACTUALLY HELD (Codex r1): a rejected or slow equip must not leave the prediction
    // describing a tool the bot is not holding. The dig is re-priced with the held item and must still fit.
    // THE WINDOW HANDOFF FIRST (airpocket-02): no equip while an interrupted skill's container window is open
    res.window = await awaitWindowHandoff(bot, { sleep, now })
    // re-checked synchronously at the call (Codex r1 P2: a window that opened after the handoff resolved)
    if (best.item && res.window !== 'open' && bot.currentWindow) res.window = 'open'
    if (best.item && res.window !== 'open') {
      let t
      try { await Promise.race([bot.equip(best.item, 'hand'), new Promise((_, rej) => { t = setTimeout(() => rej(new Error('equip timeout')), AP_EQUIP_MS) })]) } catch { /* verified below */ } finally { clearTimeout(t) }
    }
    const held = bot.heldItem ?? null
    const heldMs = predict(block, best.item && held?.name === best.item.name ? best.item : held)
    res.tool = held?.name ?? 'hand'
    res.predictedMs = Number.isFinite(heldMs) ? Math.round(heldMs) : null
    if (!(Number.isFinite(heldMs) && heldMs > 0) || heldMs * AP_MARGIN + AP_LATENCY_MS > airPocketBudgetMs({ health: bot.health, envelope })) {
      res.why = `the held ${res.tool} needs ${res.predictedMs} ms: over the budget after equip${res.window === 'open' ? ' (a container window stayed open: no equip)' : ''}`; return res
    }
    const p1 = bot.entity.position
    if (Math.floor(p1.x) !== fx || Math.floor(p1.z) !== fz || Math.floor(p1.y) < fy - 1) { res.why = 'moved off the planned column'; return res }
    best.ms = heldMs
    sample()
    // the WATCH: every 250 ms, a breach of the envelope or the budget running out stops the dig
    watch = setInterval(() => {
      sample()
      const g = guard(); if (g) aborted = aborted ?? g
      try { if (bot.controlState?.jump !== wantJump) bot.setControlState('jump', wantJump) } catch { /* not connected */ }
      if (envelopeBreached(samples, now())) aborted = aborted ?? 'envelope breached (> 7 HP in 10 s)'
      else if (budgetLeft() <= 0) aborted = aborted ?? 'health budget spent'
      // NOTHING ELSE MAY TAKE THE BODY (Claude r1: a skill started within 40 s of a capped rescue in 38% of cases, and a new
      // bot.dig stops the current one): the caller's guard interrupts any skill that starts; a dig on another block aborts.
      if (digging && bot.targetDigBlock && bot.targetDigBlock.position && !bot.targetDigBlock.position.equals?.(cellPos)) aborted = aborted ?? 'another dig took over'
      if (aborted) { try { bot.stopDigging?.() } catch { /* not digging */ } }
    }, 250)
    // THE EYE, POSE-AWARE (airpocket-02): the client's +1.62 eye is wrong whenever the standing box does not fit
    const eyeNow = () => {
      const pos = bot.entity.position
      const pe = poseEye({ y: pos.y, collides: (y0, y1) => boxCollides({ px: pos.x, pz: pos.z, y0, y1, blockAt: v => bot.blockAt(v), Vec3 }) })
      return { ...pe, block: bot.blockAt(new Vec3(Math.floor(pos.x), pe.eyeCell, Math.floor(pos.z))) }
    }
    res.redigs = 0
    let eyeInAirSince = null
    // DIG, RISE, CONFIRM -- AND DIG AGAIN IF THE CELL RE-FREEZES (airpocket-02; Paper freeze-probe trial 2: the broken ice
    // re-formed within ~1 s while the bot rose into it, and airpocket-01 logged a false success and never dug again)
    // WHAT THE CELL IS NOW decides an outcome after a re-dig went wrong (Codex r1 P1: never 'opened' over a roof)
    const cellOpen = () => { const c = bot.blockAt(cellPos); return plan.kind === 'ice' ? (isWater(c) || isAir(c)) : isAir(c) }
    for (let attempt = 0; attempt <= AP_REDIG_MAX; attempt++) {
      if (attempt > 0) {
        res.redigs = attempt
        // RE-PRICED AND RE-ADMITTED (Codex r1 P1): the first dig may have been standing; a re-dig floats
        const reMs = predict(bot.blockAt(cellPos), bot.heldItem ?? null)
        if (!(Number.isFinite(reMs) && reMs > 0) || reMs * AP_MARGIN + AP_LATENCY_MS > airPocketBudgetMs({ health: bot.health, envelope })) {
          res.why = `the cell re-formed; a re-dig needs ${Number.isFinite(reMs) ? Math.round(reMs) : reMs} ms: over the budget`
          res.outcome = 'failed'; res.refrozen = true; return res
        }
        best.ms = reMs
      }
      // NO DIG AFTER RETURN (Codex r5): mineflayer's dig awaits an unbounded lookAt before it sends start-dig, so a dig
      // whose look stalled could start after the step returned and cancel a newer dig. So the look is bounded here, the
      // preconditions are re-checked synchronously (`digGate`), and the dig is sent with forceLook 'ignore', which writes
      // start-dig inside the call with no await before it (the face sent is mineflayer's default either way).
      try { await Promise.race([bot.lookAt(cellPos.offset(0.5, 0, 0.5), true), sleep(500)]) } catch { /* a late look moves only the head */ }
      const cur = bot.blockAt(cellPos)
      const noDig = digGate({ aborted, block: cur?.name ?? null, want: plan.name, held: bot.heldItem?.name ?? null, priced: held?.name ?? null,
                              pos: bot.entity.position, fx, fy, fz })
      if (noDig) { res.why = noDig; res.outcome = aborted ? 'aborted' : (attempt > 0 && cellOpen() ? 'opened' : 'failed'); if (attempt > 0) res.refrozen = !cellOpen(); return res }
      const deadline = Math.max(1000, Math.min(budgetLeft(), Math.max(2 * best.ms, best.ms + 2000)))
      const tDig = now()
      let timer
      digging = true
      try {
        await Promise.race([
          bot.dig(cur, 'ignore'),
          new Promise((_, rej) => { timer = setTimeout(() => { try { bot.stopDigging?.() } catch {} rej(new Error(`dig exceeded ${Math.round(deadline)} ms`)) }, deadline) }),
        ])
      } catch (e) { res.why = aborted ?? `dig failed: ${String(e?.message ?? e).slice(0, 60)}`; res.outcome = aborted ? 'aborted' : (attempt > 0 && cellOpen() ? 'opened' : 'failed'); if (attempt > 0 && !aborted) res.refrozen = !cellOpen(); return res } finally { clearTimeout(timer); digging = false }
      if (attempt === 0) res.digMs = now() - tDig
      wantJump = true
      try { bot.setControlState('jump', true) } catch { /* the rise */ }
      const after = bot.blockAt(cellPos)
      const opened = plan.kind === 'ice' ? (isWater(after) || isAir(after)) : isAir(after)
      if (!opened) { res.why = `roof cell is ${after?.name ?? 'unknown'} after the dig`; return res }
      // RISE AND CONFIRM: the pose-aware eye must reach air and stay there with no health drop (airPocketConfirmed)
      eyeInAirSince = null
      let refrozen = false
      const until = now() + AP_RISE_MS + AP_CONFIRM_MS + 1000
      while (now() < until) {
        if (aborted) { res.why = aborted; res.outcome = 'aborted'; return res }
        const e = eyeNow()
        res.eye = e.block?.name ?? 'unknown'; res.pose = e.pose
        if (isAir(e.block)) {
          if (eyeInAirSince == null) eyeInAirSince = now()
          if (airPocketConfirmed({ eyeInAirSince, now: now(), samples, maxHealth })) {
            res.ok = true; res.outcome = 'success'; res.why = `breathing in ${plan.kind === 'ice' ? 'the opened column' : 'the dug pocket'}`
            res.stand = await standInPocket(bot, plan, { fx, fy, fz, Vec3, sleep, now, standItem, isAborted: () => aborted })
            return res
          }
        } else {
          eyeInAirSince = null
          const again = bot.blockAt(cellPos)
          if (again && again.name === plan.name) { refrozen = true; break }   // the dug cell is back: dig it again
        }
        await sleep(100)
      }
      if (!refrozen) break
    }
    // RE-DIGS EXHAUSTED and the cell is back (Codex r1 P1): FAILED, not opened -- the place has no air. `refrozen` asks
    // the caller for the SHORT cooldown (airPocketAfter), so the next trigger digs again within seconds, not a minute.
    if (!cellOpen()) { res.outcome = 'failed'; res.refrozen = true; res.why = `the dug cell re-formed ${res.redigs + 1} times`; return res }
    // THE POCKET EXISTS but breathing was not confirmed in the window (sandbox 5b6c530: the eye reached air briefly while
    // the bot sank). OPENED, not failed: the place now has air, so the rescue's fail memory must be cleared (its own
    // `up` route lifts the bot into the pocket) and no fail cooldown is set.
    res.outcome = 'opened'
    res.why = eyeInAirSince == null ? 'pocket open; the eye had not reached air yet' : 'pocket open; breathing not confirmed (health fell or too short)'
    return res
  } catch (e) {
    res.why = `threw: ${String(e?.message ?? e).slice(0, 60)}`
    return res
  } finally {
    if (watch) clearInterval(watch)
    try { bot.removeListener?.('health', onHealth) } catch { /* a fake */ }
    // A failed or aborted step stops its own dig of the roof cell (Codex r1).
    const ours = () => !!bot.targetDigBlock?.position && (bot.targetDigBlock.position.equals?.(cellPos) ??
      (bot.targetDigBlock.position.x === cellPos.x && bot.targetDigBlock.position.y === cellPos.y && bot.targetDigBlock.position.z === cellPos.z))
    try { if (ours() && !res.ok && res.outcome !== 'opened') bot.stopDigging() } catch {}
    // No late poll any more (Codex r5): start-dig is now sent synchronously inside bot.dig (forceLook 'ignore', above),
    // so no dig of the step's can appear after it returns. The 2-s cell-scoped poll it replaced could only have stopped
    // someone else's dig of this cell.
    res.healthEnd = bot.health
    res.ms = now() - t0
    // ON SUCCESS JUMP STAYS HELD (Claude r1): the head stays in the pocket and the rescue's own release (head out, dwell)
    // clears the controls. On failure it is released and the rescue's next tick steers again.
    if (!res.ok && res.outcome !== 'opened') { try { bot.setControlState('jump', false) } catch { /* not connected */ } }
  }
}

/**
 * STAND WITH THE EYE IN THE POCKET (Paper sandbox e142b8f, A-floor). On a floor, once the rescue releases the controls
 * the bot sinks back onto the floor with its eye in water again (Air fell to 83 of 300 before the rescue lifted it).
 * So after success, place blocks under the rising bot -- one per cell between the feet and the air cell, the pillar's
 * own jump-and-place -- until it STANDS with its eye in air. Every placement is read back; a failure stops and is reported.
 * DEEP WATER TOO (Paper sandbox 9ad287a/a56b648 A, sandbox2): with no floor the bot only floats at the pocket while
 * something holds jump; in 3 of 3 such trials the jump was dropped after success and the bot sank 6 blocks with Air at
 * 42-56 of 300 before the rescue caught it. So when the cell below is water the block is placed against a solid SIDE
 * wall of the column (`standRef`); only a cell with no solid neighbour at all is left alone. Such a block has nothing
 * under it, so it is never a falling block (`standCandidates`), and no reference is ever an interactive block.
 * Never throws. Returns 'none' | 'placed:N' | 'stopped:<why>'.
 *
 * NO PLACE AFTER RETURN (Codex r4): racing `bot.placeBlock` against a timeout bounds the WAIT, not the send --
 * mineflayer awaits its own lookAt before writing the packet, so a timed-out place could land after the step returned
 * and the rescue owned the body again. So the look is done (bounded) first, every precondition is re-checked
 * synchronously by `standGate`, and the place is sent with forceLook 'ignore', which writes the packet inside the call
 * with no await before it. The timeout that follows bounds only the wait for the server's answer.
 */
export async function standInPocket (bot, plan, { fx, fy, fz, Vec3, sleep, now, standItem, isAborted = () => null }) {
  try {
    const airY = fy + plan.dy + (plan.kind === 'ice' ? 1 : 0)   // the cell the eye must be in
    const need = airY - fy - 1                                  // blocks to stand on so feet sit at airY - 1
    if (!(need > 0)) return 'none'
    let placed = 0
    for (let k = 0; k < need; k++) {
      const cellY = fy + k
      if (isSolid(bot.blockAt(new Vec3(fx, cellY, fz)))) continue   // already solid (a floor under a swimming bot): nothing to place
      const pick = standRef({ below: bot.blockAt(new Vec3(fx, cellY - 1, fz)),
                              sides: SIDES.map(([dx, dz]) => [dx, dz, bot.blockAt(new Vec3(fx + dx, cellY, fz + dz))]) })
      if (!pick) return placed === 0 ? 'none' : `stopped:no reference for y=${cellY} (${placed} placed)`
      const item = standItem({ unsupported: !pick.supported })
      if (!item) return `stopped:no ${pick.supported ? '' : 'non-falling '}placeable block (${placed} placed)`
      if (!pick.supported && FALLING.test(item.name || '')) return `stopped:${item.name} would fall (${placed} placed)`
      if (isAborted()) return `stopped:aborted: ${isAborted()} (${placed} placed)`
      // no equip while a container window is open (the window handoff, airpocket-02)
      if (await awaitWindowHandoff(bot, { sleep, now }) === 'open' || bot.currentWindow) return `stopped:a container window is open (${placed} placed)`
      try { await Promise.race([bot.equip(item, 'hand'), sleep(1500)]) } catch { /* verified by the gate */ }
      try { bot.setControlState('jump', true) } catch {}
      const by = now() + 2500
      while (now() < by && bot.entity.position.y < cellY + 1.05 && !isAborted()) await sleep(50)
      if (isAborted()) return `stopped:aborted: ${isAborted()} (${placed} placed)`
      if (bot.entity.position.y < cellY + 1.05) return `stopped:did not rise above y=${cellY} (${placed} placed)`
      const ref = bot.blockAt(new Vec3(fx + pick.dx, cellY + pick.dy, fz + pick.dz))
      const face = new Vec3(pick.face[0], pick.face[1], pick.face[2])
      try { await Promise.race([bot.lookAt(ref.position.offset(0.5 + face.x * 0.5, 0.5 + face.y * 0.5, 0.5 + face.z * 0.5), true), sleep(500)]) } catch { /* a late look moves only the head */ }
      const no = standGate({ aborted: isAborted(), held: bot.heldItem?.name ?? null, want: item.name, pos: bot.entity.position, fx, fz, cellY })
      if (no) return `stopped:${no} (${placed} placed)`
      if (typeof bot._placeBlockWithOptions !== 'function') return `stopped:no place primitive (${placed} placed)`
      // SENT HERE, synchronously: forceLook 'ignore' leaves no await before mineflayer writes the place packet
      const answer = bot._placeBlockWithOptions(ref, face, { swingArm: 'right', forceLook: 'ignore' })
      Promise.resolve(answer).catch(() => {})   // its 5-s answer timeout must not surface as an unhandled rejection
      try { await Promise.race([answer, sleep(1500)]) } catch { /* read back */ }
      if (!isSolid(bot.blockAt(new Vec3(fx, cellY, fz)))) return `stopped:y=${cellY} did not turn solid (${placed} placed)`
      placed++
      if (isAborted()) return `stopped:aborted: ${isAborted()} (${placed} placed)`
    }
    return `placed:${placed}`
  } catch (e) { return `stopped:threw ${String(e?.message ?? e).slice(0, 40)}` }
}

const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]]
/**
 * What to place the stand block AGAINST. Pure. The block below when it is solid (a floor, or the last stand block);
 * else the first solid horizontal neighbour of the cell (a deep column's wall). null when neither exists.
 * Returns the reference's offset from the cell and the face of the reference that touches the cell.
 */
export function standRef ({ below, sides }) {
  const ok = b => isSolid(b) && !INTERACTIVE.test(b.name || '')
  if (ok(below)) return { dx: 0, dy: -1, dz: 0, face: [0, 1, 0], supported: true }
  for (const [dx, dz, b] of sides ?? []) if (ok(b)) return { dx, dy: 0, dz, face: [-dx, 0, -dz], supported: false }
  return null
}

/**
 * Which held blocks the stand may place. Pure. A block placed against a WALL has water under it, so sand, gravel and
 * every other falling block would drop through the column -- and the read-back could still see it solid for a moment
 * and log placed:1 while the bot sinks (both r7 reviews). Unsupported places take only non-falling blocks.
 */
export function standCandidates (items, { unsupported = false } = {}) {
  return (Array.isArray(items) ? items : []).filter(it => it?.name && !(unsupported && FALLING.test(it.name)))
}

/**
 * May the dig be SENT now? Pure; null = yes, otherwise the reason. Asked synchronously immediately before start-dig
 * (Codex r5): not aborted, the roof cell still holds the planned block, the tool in hand is the one the dig was priced
 * with, and the bot is still in the planned column.
 */
export function digGate ({ aborted, block, want, held, priced, pos, fx, fy, fz }) {
  if (aborted) return aborted
  if (block !== want) return `roof cell changed to ${block ?? 'unknown'}`
  if ((held ?? null) !== (priced ?? null)) return `the held item changed (${priced ?? 'hand'} -> ${held ?? 'hand'})`
  if (!pos || Math.floor(pos.x) !== fx || Math.floor(pos.z) !== fz || Math.floor(pos.y) < fy - 1) return 'moved off the planned column'
  return null
}

/**
 * May the stand place NOW? Pure; null = yes, otherwise the reason. Asked synchronously immediately before the place
 * packet is sent (Codex r4): the step is not aborted, the block the place will use is the one in hand, and the bot is
 * still in the planned column with its feet above the cell being filled (so the block cannot go into the bot).
 */
export function standGate ({ aborted, held, want, pos, fx, fz, cellY }) {
  if (aborted) return `aborted: ${aborted}`
  if (!held || held !== want) return `${want} not held (holding ${held ?? 'nothing'})`
  if (!pos || Math.floor(pos.x) !== fx || Math.floor(pos.z) !== fz) return 'moved off the planned column'
  if (!(pos.y >= cellY + 1.05)) return `feet fell below y=${cellY + 1}`
  return null
}

export const AP_ROW_MAX = 300   // logger.mjs cuts every detail at 300 characters
// FLOORED, never rounded (Codex r9): the read's C3 tests `health < 3`, and rounding would turn 2.99 into 3 and hide it
const r1 = h => (Number.isFinite(h) ? Math.floor(h * 10) / 10 : h)
/**
 * THE `_air_pocket` ROW, MACHINE FIELDS FIRST, NEVER OVER THE LOGGER'S CAP. Pure. The Paper sandbox read (562d9e7 logs)
 * found every row with a stand= field cut at 300 characters by logger.mjs -- the `| required_ms … trigger_route`
 * tail was gone, so the read's strict C0 would have reverted the canary on every attempt. Now every field the read
 * needs comes before everything optional, health is floored to 0.1, the stand reason is capped, and only the optional
 * tail is cut to fit.
 */
export function airPocketRow ({ id, r, requiredMs, budgetMs, difficulty }) {
  // REQUIRED by the read (C0) first; the optional `standing`, `eye` and `stand` after them, so only those and the why
  // can ever be cut. hunger, trigger_route and held_ms are on the START row (same id), and the read takes them from
  // there. Realistic required part ~210 characters, contrived worst ~240 (test F27).
  const head = `id=${id} outcome=${r.outcome} kind=${r.kind} cell=${r.cell} block=${r.block} tool=${r.tool} ` +
               `predicted_ms=${r.predictedMs} dig_ms=${r.digMs ?? -1} ms=${r.ms ?? -1} envelope=${r.envelope} ` +
               `health=${r1(r.healthStart)}->${r1(r.healthEnd)} | required_ms=${Math.round(requiredMs)} budget_ms=${Math.round(budgetMs)} ` +
               `difficulty=${difficulty} | standing=${r.standing ? 1 : 0} pose=${r.pose ?? 'na'}` +
               // only when they say something: a re-dig, a window that held the equip off
               `${r.redigs ? ` redig=${r.redigs}` : ''}${r.window && r.window !== 'none' ? ` window=${r.window}` : ''} eye=${r.eye} ` +
               `stand=${String(r.stand ?? 'none').slice(0, 40)} -- `
  // a success's why is always "breathing in …" (the outcome already says it); a failure's why is the diagnosis
  return (head + (r.outcome === 'success' ? '' : String(r.why ?? ''))).slice(0, AP_ROW_MAX)
}

/** One telemetry line for a step result. Pure. */
export function airPocketDetail (r) {
  return `outcome=${r.outcome} kind=${r.kind} cell=${r.cell} block=${r.block} tool=${r.tool} standing=${r.standing ? 1 : 0} predicted_ms=${r.predictedMs} ` +
         `dig_ms=${r.digMs ?? -1} ms=${r.ms ?? -1} envelope=${r.envelope} health=${r.healthStart}->${r.healthEnd} eye=${r.eye} stand=${r.stand ?? 'none'} -- ${r.why}`
}
