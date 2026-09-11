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
import { STATION_REACH } from './skills.mjs'

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
export function stationInReach (bot, name) {
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

/**
 * Ask the SKILLS' OWN predicates whether the active rung is performable now.
 *
 * Impure by necessity -- it reads the world -- and deliberately thin, so the
 * decision above stays testable without a server.
 */
export function readyFor (bot, milestone) {
  const id = milestone?.id ?? null
  const wants = milestone?.wants ?? null
  if (!id || !wants) return { id, wants, craftReady: false, smeltReady: false, smeltInput: null }

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
  return { id, wants, craftReady, smeltReady, smeltInput }
}

/**
 * The order for a rung the bot carries the means for, off the active rung.
 * Same predicates, one extra word in the reason so the log can tell them apart.
 */
export function carryOrderFor (bot, rung) {
  const order = orderFor(readyFor(bot, rung))
  if (!order) return null
  return { ...order, carry: true, why: `convert what you carry: ${order.why}` }
}

/**
 * A LOOP GUARD FOR OFF-RUNG ORDERS. The active rung has `noteAttempt` and a
 * 25-attempt give-up; a carry order is deliberately kept out of that (it must
 * not charge the active rung), so it needs its own. The bucket shape -- six
 * identical orders in three minutes, 29 attempts, one success -- is what an
 * ungated fallback would produce forever.
 *
 * Pure; the caller keeps `state`, a map of item -> {count, until}. Counts only
 * orders that were ISSUED (the caller calls this after readyFor said yes), so
 * a candidate the recipe refuses does not spend the budget. Per item, so
 * suppressing the furnace does not touch the pickaxe and alternating items do
 * not launder a loop. `limit` is 2: one attempt, and one 30 s later that the
 * admission layer's 45 s failure cooldown will usually reject -- a third would
 * only add a rejection, and three consecutive rejections trigger the livelock
 * escape, which walks the bot away from the station it needs.
 */
export const CARRY_LIMIT = 2
export const CARRY_COOL_MS = 30 * 60 * 1000
export function carryGate (state, item, now, { limit = CARRY_LIMIT, coolMs = CARRY_COOL_MS } = {}) {
  const all = { ...(state || {}) }
  const st = { ...(all[item] || { count: 0, until: 0 }) }
  if (st.until && now < st.until) { all[item] = st; return { allow: false, tripped: false, state: all } }
  if (st.until && now >= st.until) { st.count = 0; st.until = 0 }
  if (st.count >= limit) {
    st.until = now + coolMs; st.count = 0; all[item] = st
    return { allow: false, tripped: true, state: all }
  }
  st.count += 1; all[item] = st
  return { allow: true, tripped: false, state: all }
}
/** Is `item` currently suppressed? Read-only; lets the caller skip a candidate. */
export function carrySuppressed (state, item, now) {
  const st = state?.[item]
  return !!(st && st.until && now < st.until)
}
