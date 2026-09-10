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
      const carried = !!held.crafting_table
      const near = carried || !!bot.findBlock?.({
        matching: b => bot.registry?.blocks?.[b.type]?.name === 'crafting_table',
        maxDistance: 32,
      })
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
        const hasFurnace = !!held.furnace || !!bot.findBlock?.({
          matching: b => bot.registry?.blocks?.[b.type]?.name === 'furnace',
          maxDistance: 32,
        })
        const plan = smeltPlan({ held, item: input, count: 1, budgetMs: 60_000, hasFurnace })
        if (plan?.ok) { smeltReady = true; smeltInput = input; break }
      }
    } catch { smeltReady = false; smeltInput = null }
  }
  return { id, wants, craftReady, smeltReady, smeltInput }
}
