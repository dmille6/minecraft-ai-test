// Milestone controller -- ADR-0002 D3 and D6.
//
// The PLAN lives here, in deterministic code, not in the model. The LLM picks
// the next skill within the active milestone; it never decides what "done"
// means and never reorders the queue.
//
// Both cross-check analyses converged on this independently: an LLM holding a
// plan across calls has no mechanism to keep it consistent, whereas a
// controller with explicit completion predicates does.
//
// Milestones here are deliberately limited to what the CURRENT skill set can
// actually achieve. There is no craft/place/eat/sleep yet, so a bot cannot
// make a pickaxe, which means it cannot mine stone, which means "craft stone
// tools" is unreachable. Setting an impossible goal would produce failures
// that look like bad model judgement -- the worst kind of confounder.

import { countItem } from './state.mjs'
import { config } from './config.mjs'

export const MILESTONES = [
  {
    id: 'stock_wood',
    describe: 'Collect 8 oak logs. Wood is the base of every tool.',
    done: b => countItem(b, 'oak_log') >= 8,
    progress: b => `${countItem(b, 'oak_log')}/8 oak_log`,
    hint: 'gather with block=oak_log.',
  },
  {
    id: 'make_planks',
    describe: 'Craft 16 oak planks from your logs.',
    done: b => countItem(b, 'oak_planks') >= 16,
    progress: b => `${countItem(b, 'oak_planks')}/16 oak_planks (have ${countItem(b, 'oak_log')} logs)`,
    hint: 'craft with item=oak_planks. Each log yields 4 planks.',
  },
  {
    id: 'make_sticks',
    describe: 'Craft 4 sticks.',
    done: b => countItem(b, 'stick') >= 4,
    progress: b => `${countItem(b, 'stick')}/4 stick`,
    hint: 'craft with item=stick. 2 planks make 4 sticks.',
  },
  {
    id: 'crafting_table',
    describe: 'Craft a crafting table and place it. Tools need one.',
    done: b => countItem(b, 'crafting_table') >= 1 ||
               !!b.findBlock({ matching: x => b.registry.blocks[x.type]?.name === 'crafting_table', maxDistance: 12 }),
    progress: b => countItem(b, 'crafting_table') >= 1 ? 'crafted, now place it' : 'not yet crafted',
    hint: 'craft with item=crafting_table, then place with item=crafting_table.',
  },
  {
    id: 'wooden_pickaxe',
    describe: 'Craft a wooden pickaxe. Stone only drops cobblestone if mined with a pickaxe.',
    done: b => countItem(b, 'wooden_pickaxe') >= 1 || countItem(b, 'stone_pickaxe') >= 1,
    progress: b => `planks ${countItem(b, 'oak_planks')}, sticks ${countItem(b, 'stick')}`,
    hint: 'Needs a crafting_table nearby. craft with item=wooden_pickaxe.',
  },
  {
    id: 'get_cobblestone',
    describe: 'Collect 12 cobblestone.',
    done: b => countItem(b, 'cobblestone') >= 12,
    progress: b => `${countItem(b, 'cobblestone')}/12 cobblestone`,
    hint: 'gather with block=stone, or mine to y=40 first if none is visible.',
  },
  {
    id: 'stone_tools',
    describe: 'Craft a stone pickaxe.',
    done: b => countItem(b, 'stone_pickaxe') >= 1,
    progress: b => `cobblestone ${countItem(b, 'cobblestone')}, sticks ${countItem(b, 'stick')}`,
    hint: 'Needs a crafting_table nearby. craft with item=stone_pickaxe.',
  },
]

export class MilestoneController {
  constructor(bot) {
    this.bot = bot
    this.index = 0
    this.completedAt = {}
  }

  current() { return MILESTONES[this.index] ?? null }

  /** Advance past every milestone whose predicate is now satisfied. */
  refresh() {
    let advanced = false
    while (this.index < MILESTONES.length) {
      const m = MILESTONES[this.index]
      let done = false
      try { done = m.done(this.bot) } catch { done = false }
      if (!done) break
      this.completedAt[m.id] = Date.now()
      this.index++
      advanced = true
    }
    return advanced
  }

  status() {
    const m = this.current()
    if (!m) return { id: 'all_complete', describe: 'All milestones complete.', progress: '-', hint: '' }
    let progress = '-'
    try { progress = m.progress(this.bot) } catch { /* entity may be gone mid-respawn */ }
    return { id: m.id, describe: m.describe, progress, hint: m.hint }
  }

  get completedCount() { return this.index }
  get total() { return MILESTONES.length }
  get allDone() { return this.index >= MILESTONES.length }
}
