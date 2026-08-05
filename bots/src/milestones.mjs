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
    describe: 'Collect 16 oak logs. Wood is the base of every tool and structure.',
    done: bot => countItem(bot, 'oak_log') >= 16,
    progress: bot => `${countItem(bot, 'oak_log')}/16 oak_log`,
    hint: 'Use gather with block=oak_log.',
  },
  {
    id: 'stock_dirt',
    describe: 'Collect 12 dirt. Hand-mineable building material.',
    done: bot => countItem(bot, 'dirt') >= 12,
    progress: bot => `${countItem(bot, 'dirt')}/12 dirt`,
    hint: 'Use gather with block=dirt.',
  },
  {
    id: 'scout_east',
    describe: 'Scout the terrain 120 blocks east of home and report what is there.',
    done: bot => bot.entity.position.x >= config.world.homeX + 110,
    progress: bot => `x=${bot.entity.position.x.toFixed(0)}, need >= ${config.world.homeX + 110}`,
    hint: 'Use goto with the target coordinates.',
  },
  {
    id: 'return_home',
    describe: 'Return to home coordinates.',
    done: bot => bot.entity.position.distanceTo(
      { x: config.world.homeX, y: bot.entity.position.y, z: config.world.homeZ }) < 12,
    progress: bot => `${bot.entity.position.distanceTo(
      { x: config.world.homeX, y: bot.entity.position.y, z: config.world.homeZ }).toFixed(0)} blocks from home`,
    hint: 'Use the home skill.',
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
