// WHAT AN EXPLORE IS FOR.
//
// explore(ctx, { toward }) walks to the nearest recorded sighting of `toward`, and with no `toward` it walks to
// the first sighting in a fixed order that starts with iron_ore. The model cannot name `toward` (explore declares
// only `blocks`, and the grammar forbids the rest: 16,055 of 16,056 proposals carried blocks alone), so the
// iron-first order decided every walk. Measured 28-29 Sep, 80b3bbd: 1,287 of 8,766 executed explores were under a
// task that named wood, dirt, sand or stone and walked to IRON instead (9.8 execution hours); positive control, 78 of
// 78 iron-task explores chose iron correctly.
//
// The fix supplies `toward` from the active task, deterministically, AFTER admission -- so the gate's keys, cooldowns
// and learned_avoid entries are exactly what they were. It is scoped to tasks whose goal is a RAW MATERIAL a bot can
// see from a distance: gather/gatherAny rungs, the wood stockpile, and a prerequisite detour that asks for one.
// Craft, smelt, survey, patrol, travel and deposit rungs return null and keep today's behaviour.
//
// STONE IS OUT (Claude review, 09-29). 41 of 60 bots had a stone sighting inside explore's 24-block floor, and a stone
// gather fails because every candidate is BURIED, not because none is near -- so aiming at stone walks ~34 blocks to
// more buried stone. The stone rungs and gather_cobblestone keep today's explore.

// The only kinds the reflex records as sightings (reflex.mjs SURVEY_BLOCKS minus water). A kind outside this set can
// never have a sighting, and returning it would silently turn a directed walk into an unaimed one.
export const SIGHTABLE = ['oak_log', 'birch_log', 'spruce_log', 'stone', 'coal_ore', 'iron_ore', 'sand']
const LOGS = ['oak_log', 'birch_log', 'spruce_log']

// What an ITEM the task counts is found as. Explicit rather than derived from drop tables: the sighting list is
// seven blocks long, and each line here is a claim that finding that block yields the item the task counts.
const FOUND_AS = {
  oak_log: ['oak_log'], birch_log: ['birch_log'], spruce_log: ['spruce_log'],
  coal: ['coal_ore'], coal_ore: ['coal_ore'], deepslate_coal_ore: ['coal_ore'],
  raw_iron: ['iron_ore'], iron_ore: ['iron_ore'], deepslate_iron_ore: ['iron_ore'],
  sand: ['sand'],
}

const norm = s => String(s ?? '').toLowerCase().replace(/^minecraft:/, '')

/**
 * Pure: the sighting kinds an explore under `task` should walk toward, or null for "not this change's business".
 *
 * `wantsAny` is the whole accepted family (any log counts toward gatherAny); `wants` alone is literal (gather
 * oak_log 8 counts oak only, so birch is not the goal). The stockpile rungs carry no `wants`; they are named by id.
 * A `wants` that is unmapped -- a pickaxe, planks, a furnace, dirt, stone -- returns null, family or not. In a
 * `wantsAny` family whose main item IS mapped, unmapped members are dropped and the rest aim the walk.
 */
export function exploreKindsFor (task) {
  if (!task) return null
  const named = Array.isArray(task.wantsAny) && task.wantsAny.length ? task.wantsAny
    : task.wants ? [task.wants] : null
  // THE MAIN ITEM MUST BE SIGHTABLE. The scaffold detour wants dirt (no tool, never sighted) in a family that includes
  // stone (needs a pickaxe): aiming it at the family would send a sealed bot toward the one member it cannot mine.
  if (task.wants && !FOUND_AS[norm(task.wants)]) return null
  if (named) {
    const kinds = new Set()
    for (const item of named) {
      const found = FOUND_AS[norm(item)]
      if (found) for (const k of found) kinds.add(k)
    }
    return kinds.size ? { kinds: [...kinds], source: task.wantsAny?.length ? 'wantsAny' : 'wants' } : null
  }
  const id = String(task.id ?? '')
  if (/^stockpile_wood(?:#|$)/.test(id)) return { kinds: [...LOGS], source: 'stockpile' }
  return null
}

/**
 * Pure: the args the runner gets for an admitted explore. A copy -- the admitted args stay what the gate saw, so the
 * failure and lesson keys downstream are unchanged. An explicit `toward` (a chat command) is never overridden.
 */
export function exploreArgsFor (args, task) {
  const a = { ...(args ?? {}) }
  if (a.toward != null) return { args: a, intent: null }
  const intent = exploreKindsFor(task)
  if (!intent) return { args: a, intent: null }
  a.toward = intent.kinds
  a.intentTask = String(task?.id ?? '')
  return { args: a, intent }
}
