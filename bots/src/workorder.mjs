// THE LADDER WAS A SCOREBOARD, NOT AN ACTUATOR.
//
// The measurement that produced this file: when the milestone chain lands on a
// craft rung, the model picks the craft verb 27-60% of the time against an 8.4%
// baseline. So the goal channel WORKS. And the skills work -- craft succeeds
// 36.7% at 5.8 items per success, smelt 68.6%, the highest-value verbs in the
// fleet. What does not work is CHOOSING: the fleet calls `gather` 26 times for
// every `smelt`, and carries idle stockpiles (292 cobblestone on one bot, 806
// bankable items on another) while the ladder stalls in the middle.
//
// That gap is the repo's own oldest lesson wearing new clothes. `advice printed
// is not advice taken` -- one refusal named the correct remedy 262 times and the
// model never acted on it. The tech ladder is the same shape: a hint that says
// "craft with item=stone_pickaxe" to a bot already holding the cobblestone and
// the sticks, 30 seconds at a time, forever.
//
// So when the ACTIVE RUNG is a conversion and the bot can already perform it,
// perform it. Do not spend a decision asking a 7B to notice.
//
// EVERY PREDICATE HERE IS THE SKILL'S OWN. Not a paraphrase of it -- the actual
// function the executor will call. Nine of the last ten defects on this project
// were a producer and a consumer disagreeing about a re-implemented predicate:
// the ranking probe validated one goal while the walk demanded another; `craft`
// said "place a table" while `place` had just failed; the affordance line
// counted carried tables while `craft` accepts placed ones. A work order that
// invented its own feasibility test would be the tenth.

import { smeltInputsFor, smeltPlan } from './smelting.mjs'
import { STATION_REACH, craftRoomCheck } from './skills.mjs'

/**
 * Rung ids are `craft_<item>_<n>` and `smelt_<output>_<n>` AS CONSTRUCTED --
 * and that is not the shape they arrive in.
 *
 * `MilestoneController.status()` rewrites the id before anyone downstream sees
 * it: a sustaining rung is emitted as `${m.id}#${cycle}`. The first version of
 * this file anchored on the CONSTRUCTOR's shape, matched nothing, and shipped
 * completely inert -- 0 fires across 80 bots and 20,193 rows. Its tests passed
 * because I wrote the fixtures from the same wrong assumption, so the fixture
 * and the code were wrong together and agreed.
 *
 * Measured on the live fleet afterwards: 100% of observed rung ids carry the
 * suffix, `#0` included. So the suffix is the normal case, not the edge one.
 *
 * `+prereq` (applyPrereq) is deliberately NOT stripped -- a preempted rung
 * means the bot needs the material, not the conversion.
 */
const CYCLE_SUFFIX = /#\d+$/
const CRAFT_RUNG = /^craft_(.+)_(\d+)$/
const SMELT_RUNG = /^smelt_(.+)_(\d+)$/

/** The rung id as the chain built it, with the emitter's cycle suffix removed. */
export const rungId = id => String(id ?? '').replace(CYCLE_SUFFIX, '')

/**
 * Is a station usable FROM HERE, with no walk?
 *
 * v1 asked `findBlock({ maxDistance: 32 })` and called that ready. 32 is the
 * SEARCH radius; the binding condition is the one `craft` and `smelt` actually
 * enforce, `distanceTo(centre) <= STATION_REACH`. Measured over the first 90
 * minutes live: 13 of 65 work-ordered conversions failed and 12 of those were
 * `no_path` -- "crafting_table is 7/9/11/12/19 blocks away and could not be
 * reached". The order was issued for a walk that then failed.
 *
 * So the test is the skill's own, imported rather than retyped, and measured
 * the same way the skill measures it: position to block CENTRE.
 *
 * This deliberately forgoes a distant-but-walkable station. That is the point:
 * the work order exists for conversions the bot can ALREADY perform, and a
 * twelve-block walk is not "already". The model can still choose to craft and
 * make the walk itself -- declining here removes a wasted order, not an option.
 */
function stationInReach (bot, name) {
  const b = bot.findBlock?.({
    matching: blk => bot.registry?.blocks?.[blk.type]?.name === name,
    maxDistance: Math.ceil(STATION_REACH) + 1,
  })
  if (!b?.position?.offset) return false
  return bot.entity.position.distanceTo(b.position.offset(0.5, 0.5, 0.5)) <= STATION_REACH
}

/**
 * The order to run, or null.
 *
 * PURE, and that is the point: this is the decision, and a decision that can
 * only be checked by reading the code around it is a decision that drifts. The
 * caller supplies the feasibility booleans it computed from the real skill
 * predicates; this function only decides what to do with them.
 */
export function orderFor ({ id = null, wants = null, craftReady = false,
                            smeltReady = false, smeltInput = null } = {}) {
  if (!id || !wants) return null
  const rung = rungId(id)
  const c = CRAFT_RUNG.exec(rung)
  if (c && craftReady) {
    return { skill: 'craft', args: { item: wants, count: 1 },
             why: `active rung ${id} and the recipe is satisfiable from inventory` }
  }
  const s = SMELT_RUNG.exec(rung)
  if (s && smeltReady && smeltInput) {
    // smelt takes the INPUT, not the output. `smelt item=iron_ingot` has no
    // recipe the registry will ever return -- the milestone hint says so
    // explicitly, and this project has twice shipped advice naming a move the
    // model cannot make.
    return { skill: 'smelt', args: { item: smeltInput, count: 1 },
             why: `active rung ${id} and ${smeltInput} is smeltable with fuel in hand` }
  }
  return null
}

// PLANTING. The fleet gathers 3,605 logs a day, picks up 485 saplings a day, and
// plants ZERO -- no sapling has ever appeared in a place attempt. Measured
// 2026-09-26: items/bot-hour fell 55.73 -> 14.82 over fourteen days while gather
// ATTEMPTS stayed flat at ~18/bot-h and items per SUCCESSFUL gather fell 9.43 ->
// 4.23. That is a resource base being consumed, not a policy getting worse, and
// log gather -- the most depletable thing the fleet touches -- fell hardest, 24.3%
// -> 9.1%. The controlled comparison already on file: 38.3% on fresh worlds vs
// 9.3% on worn, identical code.
//
// Every bot is already carrying the answer. Inventories sampled over 480 bot-h:
// 100% of rows held at least one sapling, all 80 bots, median PEAK 100 and one bot
// at 330.

// A reserve, so planting can never consume the last sapling a recipe might want.
// Free at these stock levels; it exists so this obligation cannot starve anything.
export const PLANT_RESERVE = 8

// AT MOST ONE PLANT PER TEN MINUTES PER BOT. A deterministic obligation spends a
// DECISION, and decisions are the scarce resource -- 91/bot-h measured. Six plants
// an hour is ~6% of them, which bounds the worst case if this is wrong. It is a
// cap, not a target.
export const PLANT_COOLDOWN_MS = 10 * 60 * 1000


/**
 * IS THE PLANTING OBLIGATION ON FOR THIS BOT? Pure, so the split can be tested
 * without a fleet.
 *
 * DEFAULT ON, and the choice of default is the load-bearing part. This exists so
 * half the worlds can plant and half can be the control over the seven days a
 * tree needs, and the arm is carried in the ENV rather than in a second code
 * version -- the death tripper matches `canary_pool` literally and two live
 * versions halts eighty bots.
 *
 * Defaulting OFF would mean a failed env write silently ships an inert feature,
 * which is the failure mode this project has hit five times in one day. With the
 * default ON, a failed env write degrades to "every world plants" -- which is
 * exactly what the owner asked for, so the worst case is the stated intent minus
 * the measurement, not a dead feature that reads as a refuted one.
 */
export function plantingEnabled (env = {}) {
  const v = env.PLANT_ENABLED
  if (v === undefined || v === null || v === '') return true
  return !/^(0|false|no|off)$/i.test(String(v).trim())
}


/**
 * SHOULD THE BOT PLANT, AND WHAT? Pure. `spot` is a plantable cell the caller
 * already validated with isPlantable(); this decides only whether to spend a
 * decision on it and which species to spend.
 *
 * Returns the same shape as orderFor(), so the caller treats both identically.
 */
export function plantingOrder ({ saplings = {}, spot = null, now = 0, lastPlantedAt = 0 } = {}) {
  if (!spot) return null
  if (now - (lastPlantedAt || 0) < PLANT_COOLDOWN_MS) return null
  const best = Object.entries(saplings)
    .filter(([k, v]) => k.endsWith('_sapling') && Number.isFinite(v) && v > PLANT_RESERVE)
    .sort((a, b) => b[1] - a[1])[0]
  if (!best) return null
  return {
    skill: 'place',
    args: { item: best[0], x: spot.x, y: spot.y, z: spot.z },
    why: `holding ${best[1]} ${best[0]} on plantable ground; the fleet takes 3,605 logs a day and plants none`,
  }
}

/**
 * Ask the SKILLS' OWN predicates whether the active rung is performable now.
 *
 * Impure by necessity -- it reads the world -- and deliberately thin, so the
 * decision above stays testable without a server.
 */
export function readyFor (bot, milestone, { roomCheck = craftRoomCheck, wearFailedRecently = false } = {}) {
  const id = milestone?.id ?? null
  const wants = milestone?.wants ?? null
  if (!id || !wants) return { id, wants, craftReady: false, smeltReady: false, smeltInput: null, noRoom: null }
  let noRoom = null, roomVia = null

  // This runs on EVERY decision, before the LLM call. An exception here costs
  // the bot its whole turn, so nothing in this function may propagate one --
  // not the inventory read, and not the world queries below.
  const held = {}
  try {
    for (const it of bot?.inventory?.items?.() ?? []) {
      held[it.name] = (held[it.name] ?? 0) + it.count
    }
  } catch { /* an unreadable inventory is a not-ready, never a lost turn */ }

  let craftReady = false
  if (CRAFT_RUNG.test(rungId(id))) {
    try {
      const def = bot.registry?.itemsByName?.[wants]
      // A crafting table counts whether it is CARRIED or PLACED nearby -- the
      // same rule `craft` itself follows when it resolves prerequisites, and
      // the distinction that made the prompt's affordance line wrong.
      // Carried counts with no distance test at all: `craft` places the table
      // itself, so the bot is standing on top of it by construction.
      const carried = !!held.crafting_table
      const near = carried || stationInReach(bot, 'crafting_table')
      craftReady = !!def && (bot.recipesFor(def.id, null, 1, near ? true : null) ?? []).length > 0
      // NO CRAFT ORDER WITHOUT ROOM (orderroom-01): the craft skill's own room check (skills.mjs craftRoomCheck). No
      // room -> no order, and `noRoom` names the shortfall so the caller can issue the remedy instead. `ok: null`
      // (cannot say) issues the order exactly as before.
      if (craftReady && roomCheck) {
        const room = roomCheck(bot, wants, 1, { wearFailedRecently })
        if (room?.ok === false) { craftReady = false; noRoom = { item: wants, short: room.short, slots: room.slots, keep: room.keep ?? [], route: room.route ?? null } }
        else roomVia = room?.ok === true ? room.via ?? null : null
      }
    } catch { craftReady = false }
  }

  let smeltReady = false, smeltInput = null
  if (SMELT_RUNG.test(rungId(id))) {
    try {
      const inputs = smeltInputsFor(wants) ?? []
      for (const input of inputs) {
        // hasFurnace is true when one is carried OR placed nearby: `smelt`
        // places a carried furnace itself, so refusing here would be stricter
        // than the executor.
        const hasFurnace = !!held.furnace || stationInReach(bot, 'furnace')
        const plan = smeltPlan({ held, item: input, count: 1, budgetMs: 60_000, hasFurnace })
        if (plan?.ok) { smeltReady = true; smeltInput = input; break }
      }
    } catch { smeltReady = false; smeltInput = null }
  }
  return { id, wants, craftReady, smeltReady, smeltInput, noRoom, roomVia }
}

// --------------------------------------------------------------------------
// THE ROOM ORDER (orderroom-01, 2026-10-10)
// --------------------------------------------------------------------------
//
// readyFor withholds a rung craft the bag cannot hold (noRoom). The remedy the craft's own refusal would name
// (skills.mjs roomRemedy) becomes the order, so it is EXECUTED rather than printed: measured 10-10, the model took the
// named remedy 14 of 112 times it had the turn, and the order it replaced was refused 3,608 times in 13.5 h.
// Pure: the caller reads the world (noRoom, the remedy, the bag) and keeps the state.

export const ROOM_BACKOFF_MS = 10 * 60 * 1000
export const ROOM_INTERRUPTED = new Set(['path_interrupted', 'interrupted', 'hazard_interrupt'])
export const ROOM_REFUSED_BACKOFF_MS = 2 * 60 * 1000
// NO `place`: craft never places to make room (a block beside the bot can seal a tunnel or a stair) and no cheap test
// proves an exit stays open (Codex r1); skills.mjs roomRemedy never names it as an order.
const ROOM_ORDER_OF = {
  eat: () => ({ skill: 'eat', args: {} }),
  deposit: item => ({ skill: 'deposit', args: { item } }),
  home: () => ({ skill: 'home', args: {} }),
}
export const ROOM_ORDER_KINDS = new Set(Object.keys(ROOM_ORDER_OF))

/** The kinds still backing off at `now` (roomRemedy skips them, so the next remedy is named). */
export function roomBackedOff (state = {}, now = 0) {
  return new Set(Object.entries(state.backoff ?? {}).filter(([, t]) => now < t).map(([k]) => k))
}

/**
 * -> { order, state }. An order only for a kind that runs (eat, deposit, home) and that is not backing off, and
 * issued at most once per tick (the caller resolves `pending` with roomOutcome in the same tick). closed / none: no order --
 * the model decides.
 */
export function roomOrder ({ noRoom = null, remedy = null, now = 0, state = {}, slots = 0 } = {}) {
  const s = { ...state, backoff: { ...(state.backoff ?? {}) } }
  const none = () => ({ order: null, state: s })
  if (!noRoom || !remedy || !ROOM_ORDER_KINDS.has(remedy.kind)) return none()
  if (roomBackedOff(s, now).has(remedy.kind)) return none()
  if (remedy.kind === 'deposit' && !remedy.item) return none()
  const o = ROOM_ORDER_OF[remedy.kind](remedy.item)
  s.pending = { kind: remedy.kind, item: remedy.item ?? null, craft: noRoom.item, short: noRoom.short ?? null, slots, at: now }
  return { order: { ...o, why: `no room for ${noRoom.item} (${noRoom.short ?? '?'} slot(s) short): ${String(remedy.text ?? '').slice(0, 140)}`, room: s.pending }, state: s }
}

/**
 * After the room order ran (or was refused) -> { state, freed, verdict }. FREED IS MEASURED, never assumed: the bag's
 * slot count after the run against the count when it was issued. A home walk that arrived is its own success (the
 * deposit at home is the next room order); one that made progress (travel_incomplete) keeps walking. Anything else
 * -- failed, no_effect, nothing freed, refused at admission -- backs that kind off, and the next tick names the next one.
 */
export function roomOutcome ({ status = null, failClass = null, refused = false, slotsAfter = 0, stillFar = false, now = 0, state = {} } = {}) {
  const s = { ...state, backoff: { ...(state.backoff ?? {}) } }
  const p = s.pending
  s.pending = null
  if (!p) return { state: s, freed: 0, verdict: 'none' }
  const freed = Math.max(0, (p.slots ?? 0) - (slotsAfter ?? 0))
  let verdict
  if (refused) { s.backoff[p.kind] = now + ROOM_REFUSED_BACKOFF_MS; verdict = 'refused' }
  else if (freed > 0 || (p.kind === 'home' && status === 'success' && !stillFar)) { s.backoff[p.kind] = 0; verdict = 'ok' }
  // AN INTERRUPTION IS FREE (Claude r2), as for the town orders: a reflex took the body; nothing was learned about the remedy.
  // ...and so is one the SKILL reports as an interrupted walk (deposit/home return failed + path_interrupted when a reflex
  // stops the path mid-walk, skills.mjs deposit) -- Claude r3.
  else if (status === 'aborted' || ROOM_INTERRUPTED.has(failClass)) verdict = 'interrupted'
  else if (p.kind === 'home' && failClass === 'travel_incomplete') verdict = 'walking'
  else { s.backoff[p.kind] = now + ROOM_BACKOFF_MS; verdict = 'backoff' }
  return { state: s, freed, verdict, pending: p }
}

/** How long a craft refused for room keeps the craft's own wear-out route from being trusted (craftRoomCheck). */
export const ROOM_WEAR_TRUST_MS = 10 * 60 * 1000

/**
 * WHICH REMEDY KINDS TO LEAVE OUT -> Set. Backing off, or refused by the gate's memory (AdmissionControl.memoryRefuses).
 * AND `home` WHEN THE DEPOSIT IT LEADS TO IS BLOCKED BY SOMETHING THE WALK WILL NOT CLEAR (Codex r2): learned failures,
 * a full repeat window, or the deposit's own backoff -- arriving home would only find `none`. A deposit cooldown (45 s) is
 * over long before a walk home is, so it does not stop the walk.
 */
export function roomExclusions ({ backedOff = new Set(), memory = {} } = {}) {
  const ex = new Set(backedOff)
  for (const [kind, why] of Object.entries(memory ?? {})) if (why) ex.add(kind)
  const dep = memory?.deposit
  if ((dep && dep !== 'cooldown') || backedOff.has('deposit')) ex.add('home')
  return ex
}

/**
 * The `_room_order` row's `lost`: every name whose count fell between the issue and the outcome, `name:n` comma-joined,
 * at most `cap` characters; more is marked `+more` so the read can see the list is incomplete (Codex r2: a silent
 * truncation could hide the very loss C2 looks for). `-` when nothing fell.
 */
export function lostLine (before = {}, after = {}, cap = 110) {
  const lost = Object.entries(before).filter(([k, v]) => (after[k] ?? 0) < v).sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${k}:${v - (after[k] ?? 0)}`)
  if (!lost.length) return '-'
  // CAPPED BY CHARACTERS (Claude r2): the row's 300-char cap must never cut the `+more` marker itself.
  const kept = []
  for (const e of lost) { if ([...kept, e].join(',').length > cap) break; kept.push(e) }
  return kept.join(',') + (kept.length < lost.length ? ',+more' : '')
}
