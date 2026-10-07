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
export const AP_CONFIRM_MS = 2000            // the eye must stay in air this long
export const AP_RISE_MS = 4000               // after the dig, the eye has this long to reach air
export const AP_TRIGGER_AFTER_MS = 8000      // a non-sealed, capped rescue gets this long to work before the dig
export const AP_FAIL_COOLDOWN_MS = 60_000    // a failed or aborted step is not retried here for a minute
export const AP_REFUSE_COOLDOWN_MS = 5000    // a refused plan is re-planned at most this often (it is cheap)
export const AP_ICE_ENABLED = true             // the ice branch (break, then rise one cell); off if sandbox scene F fails
export const AP_EQUIP_MS = 1500               // equip is bounded too (Codex r1): it runs before the dig's deadline
export const AP_NOT_CLOSING_MS = 4000         // a non-sealed rescue must have stopped closing on air this long
export const AP_WANT_LAPSE_MS = 3000          // a pre-empt request lapses unless renewed (it is renewed every tick)

import { difficultyOf } from './foodskip.mjs'

const WATERLIKE = /^(water|flowing_water|bubble_column|kelp|kelp_plant|seagrass|tall_seagrass)$/
const LAVALIKE = /lava|^magma_block$|^fire$|^soul_fire$/
const FALLING = /^(sand|red_sand|gravel|suspicious_sand|suspicious_gravel|anvil|chipped_anvil|damaged_anvil|pointed_dripstone|dragon_egg|scaffolding)$|concrete_powder$/
const NO_DIG = /^(bedrock|barrier|end_portal_frame|command_block|structure_block|jigsaw|reinforced_deepslate|spawner|trial_spawner|vault|chest|trapped_chest|barrel|ender_chest|furnace|blast_furnace|smoker|composter|crafting_table)$|shulker_box$/
const ICE = /^(ice|frosted_ice)$/            // breaks into WATER over water; packed/blue ice do not and take the pocket rule
const AIRLIKE = /^(air|cave_air|void_air)$/

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
export function airPocketPlan (at) {
  const refuse = (why, extra = {}) => ({ ok: false, why, kind: null, dy: null, name: null, ...extra })
  const feet = at(0, 0, 0), head = at(0, 1, 0)
  if (feet == null || head == null) return refuse('own cells unknown')
  if (!isWater(head)) return refuse(`head cell is ${head.name}, not water`)
  if (!isWater(feet) && !isAir(feet)) return refuse(`feet cell is ${feet.name}`)
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
      return { ok: true, why: null, kind: 'ice', dy, name: b.name }
    }
    if (!isSolid(b)) return refuse(`${b.name} is not a full block`, { dy, name: b.name })
    if (NO_DIG.test(b.name)) return refuse(`${b.name} is not dug`, { dy, name: b.name })
    const around = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => at(dx, dy, dz))
    const top = at(0, dy + 1, 0)
    if (around.some(s => s == null) || top == null) return refuse('a neighbour of the roof cell is unknown', { dy, name: b.name })
    const wet = around.find(isLiquid)
    if (wet) return refuse(`${wet.name} beside the roof cell would fill the pocket`, { dy, name: b.name })
    if (isLiquid(top)) return refuse(`${top.name} above the roof cell would fill the pocket`, { dy, name: b.name })
    if (FALLING.test(top.name)) return refuse(`${top.name} above the roof cell would fall in`, { dy, name: b.name })
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
 * BREATHING, CONFIRMED? Pure. The eye has been in an air cell for >= 2 s AND health is rising since the eye got there
 * (a breathing bot heals in peaceful) or is already at its maximum. "Not falling" is NOT enough: a drowning bot shows
 * flat health for ~30 s (sandbox).
 */
export function airPocketConfirmed ({ eyeInAirSince = null, now = Date.now(), health, healthAtEyeIn, maxHealth = 20 }) {
  if (eyeInAirSince == null || now - eyeInAirSince < AP_CONFIRM_MS) return false
  return health > healthAtEyeIn || health >= maxHealth
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
                                    active = false, now = Date.now(), cooldownUntil = 0, stepWouldRun = () => false }) {
  if (!rescuing || active || pocketing || now < cooldownUntil) return false
  if (routeDir === 'up' || routeSealed !== true) return false
  if (!(escaping || marooned)) return false
  // ONLY FOR A STEP THAT WOULD RUN (both reviews r2): an escape is never stopped for a step that then refuses. Asked
  // last, because it reads blocks (plan + admission, no side effects).
  return stepWouldRun() === true
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
export function airPocketAfter (ok, state, now = Date.now()) {
  // `ok` is true for a success AND for an OPENED pocket: either way the place now has air.
  if (ok) return { ...state, drownFails: 0, drownFailPos: null, drownFailHealth: null, seizedAt: now, lastProgressAt: now }
  return { ...state, cooldownUntil: now + AP_FAIL_COOLDOWN_MS }
}

/**
 * THE STEP. Impure: digs the planned cell and confirms breathing. The caller holds the body (the air reflex's grant)
 * and keeps every other tick out while this runs. Returns {ok, outcome, why, ...} and never throws.
 *   deps.blockAt(vec) / deps.Vec3 / deps.predict(block, item) -> ms / deps.sleep(ms) / deps.now()
 */
export async function airPocketStep (bot, plan, { Vec3, predict, sleep = ms => new Promise(r => setTimeout(r, ms)),
                                                 now = () => Date.now(), maxHealth = 20, envelope, guard = () => null } = {}) {
  const t0 = now()
  const p0 = bot.entity.position
  const fx = Math.floor(p0.x), fy = Math.floor(p0.y), fz = Math.floor(p0.z)
  const cellPos = new Vec3(fx, fy + plan.dy, fz)
  const samples = []
  const sample = () => { samples.push({ t: now(), hp: bot.health }) }
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
    const items = (bot.inventory?.items?.() ?? []).filter(it => /_(pickaxe|shovel|axe)$/.test(it.name))
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
    if (best.item) {
      let t
      try { await Promise.race([bot.equip(best.item, 'hand'), new Promise((_, rej) => { t = setTimeout(() => rej(new Error('equip timeout')), AP_EQUIP_MS) })]) } catch { /* verified below */ } finally { clearTimeout(t) }
    }
    const held = bot.heldItem ?? null
    const heldMs = predict(block, best.item && held?.name === best.item.name ? best.item : held)
    res.tool = held?.name ?? 'hand'
    res.predictedMs = Number.isFinite(heldMs) ? Math.round(heldMs) : null
    if (!(Number.isFinite(heldMs) && heldMs > 0) || heldMs * AP_MARGIN + AP_LATENCY_MS > airPocketBudgetMs({ health: bot.health, envelope })) {
      res.why = `the held ${res.tool} needs ${res.predictedMs} ms: over the budget after equip`; return res
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
    const deadline = Math.max(1000, Math.min(budgetLeft(), Math.max(2 * best.ms, best.ms + 2000)))
    const tDig = now()
    let timer
    digging = true
    try {
      await Promise.race([
        bot.dig(block),
        new Promise((_, rej) => { timer = setTimeout(() => { try { bot.stopDigging?.() } catch {} rej(new Error(`dig exceeded ${Math.round(deadline)} ms`)) }, deadline) }),
      ])
    } catch (e) { res.why = aborted ?? `dig failed: ${String(e?.message ?? e).slice(0, 60)}`; res.outcome = aborted ? 'aborted' : 'failed'; return res } finally { clearTimeout(timer); digging = false }
    res.digMs = now() - tDig
    wantJump = true
    try { bot.setControlState('jump', true) } catch { /* the rise */ }
    const after = bot.blockAt(cellPos)
    const opened = plan.kind === 'ice' ? (isWater(after) || isAir(after)) : isAir(after)
    if (!opened) { res.why = `roof cell is ${after?.name ?? 'unknown'} after the dig`; return res }
    // RISE AND CONFIRM: the eye must reach air and stay there while health rises (or is at its maximum)
    let eyeInAirSince = null, healthAtEyeIn = null
    const until = now() + AP_RISE_MS + AP_CONFIRM_MS + 1000
    while (now() < until) {
      if (aborted) { res.why = aborted; res.outcome = 'aborted'; return res }
      const pos = bot.entity.position
      const eye = bot.blockAt(new Vec3(Math.floor(pos.x), Math.floor(pos.y + 1.62), Math.floor(pos.z)))
      res.eye = eye?.name ?? 'unknown'
      if (isAir(eye)) {
        if (eyeInAirSince == null) { eyeInAirSince = now(); healthAtEyeIn = bot.health }
        if (airPocketConfirmed({ eyeInAirSince, now: now(), health: bot.health, healthAtEyeIn, maxHealth })) {
          res.ok = true; res.outcome = 'success'; res.why = `breathing in ${plan.kind === 'ice' ? 'the opened column' : 'the dug pocket'}`
          return res
        }
      } else { eyeInAirSince = null; healthAtEyeIn = null }
      await sleep(100)
    }
    // THE POCKET EXISTS but breathing was not confirmed in the window (sandbox 5b6c530: the eye reached air briefly while
    // the bot sank). OPENED, not failed: the place now has air, so the rescue's fail memory must be cleared (its own
    // `up` route lifts the bot into the pocket) and no fail cooldown is set.
    res.outcome = 'opened'
    res.why = eyeInAirSince == null ? 'pocket open; the eye had not reached air yet' : 'pocket open; breathing not confirmed (health did not rise)'
    return res
  } catch (e) {
    res.why = `threw: ${String(e?.message ?? e).slice(0, 60)}`
    return res
  } finally {
    if (watch) clearInterval(watch)
    // NO LATE DIG (Codex r1): mineflayer installs a dig's cancel handler only after its own lookAt, so a deadline can
    // fire before the dig exists; stop it now and once more shortly after.
    const ours = () => !!bot.targetDigBlock?.position && (bot.targetDigBlock.position.equals?.(cellPos) ??
      (bot.targetDigBlock.position.x === cellPos.x && bot.targetDigBlock.position.y === cellPos.y && bot.targetDigBlock.position.z === cellPos.z))
    try { if (ours() && !res.ok && res.outcome !== 'opened') bot.stopDigging() } catch {}
    // poll for 2 s: a dig whose own lookAt resolves after the step returned is stopped as soon as it appears. Residual
    // (Codex r3): this is cell-scoped, not operation-scoped -- another dig of THIS cell within 2 s of a failed step would
    // be stopped too; nothing else digs the roof cell over a drowning bot in that window (the escape is pre-empted,
    // the step cools down 60 s).
    if (!res.ok && res.outcome !== 'opened') {
      let n = 0
      const late = setInterval(() => { try { if (ours()) bot.stopDigging() } catch {} if (++n >= 20) clearInterval(late) }, 100)
    }
    res.healthEnd = bot.health
    res.ms = now() - t0
    // ON SUCCESS JUMP STAYS HELD (Claude r1): the head stays in the pocket and the rescue's own release (head out, dwell)
    // clears the controls. On failure it is released and the rescue's next tick steers again.
    if (!res.ok && res.outcome !== 'opened') { try { bot.setControlState('jump', false) } catch { /* not connected */ } }
  }
}

/** One telemetry line for a step result. Pure. */
export function airPocketDetail (r) {
  return `outcome=${r.outcome} kind=${r.kind} cell=${r.cell} block=${r.block} tool=${r.tool} standing=${r.standing ? 1 : 0} predicted_ms=${r.predictedMs} ` +
         `dig_ms=${r.digMs ?? -1} ms=${r.ms ?? -1} envelope=${r.envelope} health=${r.healthStart}->${r.healthEnd} eye=${r.eye} -- ${r.why}`
}
