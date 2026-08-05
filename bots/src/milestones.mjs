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

// Role-specific chains. Three bots running the identical chain would fail in
// the identical way, which teaches us nothing beyond what one bot already
// showed. Different goals exercise different skills and surface different
// failure modes -- which is the point of running several.
//
// Every chain stays inside what the CURRENT skill set can actually achieve.
// An impossible goal produces failures that look like bad model judgement,
// which is the worst kind of confounder.

const M = {
  gather: (block, n, why) => ({
    id: `gather_${block}_${n}`,
    describe: `Collect ${n} ${block}. ${why}`,
    done: b => countItem(b, block) >= n,
    progress: b => `${countItem(b, block)}/${n} ${block}`,
    hint: `gather with block=${block}.`,
  }),
  craft: (item, n, why, hint) => ({
    id: `craft_${item}_${n}`,
    describe: `Craft ${n} ${item}. ${why}`,
    done: b => countItem(b, item) >= n,
    progress: b => `${countItem(b, item)}/${n} ${item}`,
    hint: hint ?? `craft with item=${item}.`,
  }),
  // Direction-and-distance, not an exact spot. A fixed coordinate can be
  // genuinely unreachable -- observed: "no route toward 150,0" -- and then the
  // milestone can never complete and the bot loops on it forever. Rewarding
  // displacement lets any workable route count.
  travel: (dx, dz, why) => ({
    id: `travel_${dx}_${dz}`,
    describe: `Travel toward ${dx},${dz} and report what you find. ${why} ` +
              `Getting most of the way counts — if a route is blocked, try a nearer waypoint.`,
    done: b => Math.hypot(b.entity.position.x - dx, b.entity.position.z - dz) < 60,
    progress: b => `${Math.round(Math.hypot(b.entity.position.x - dx, b.entity.position.z - dz))} blocks from ${dx},${dz} (need within 60)`,
    hint: `goto toward x=${dx}, z=${dz}. If that reports "no route", aim at a closer point in the same direction.`,
  }),
}

export const MILESTONES_BY_ROLE = {
  // Wood then distance. Exercises gather + goto, and travelling is where
  // pathfinding and terrain hazards actually bite.
  scout: [
    M.gather('oak_log', 8, 'Wood is the base of every tool.'),
    M.travel(150, 0, 'Scouting east.'),
    M.gather('oak_log', 16, 'Restock while out there.'),
    M.travel(0, 150, 'Scouting south.'),
  ],

  // The full tool chain. Exercises craft and place, which have entirely
  // different failure modes from gather -- missing ingredients rather than
  // unreachable blocks.
  miner: [
    M.gather('oak_log', 8, 'Tools start with wood.'),
    M.craft('oak_planks', 16, 'Each log yields 4 planks.'),
    M.craft('stick', 8, '2 planks make 4 sticks.'),
    M.craft('crafting_table', 1, 'Tools need one nearby.',
            'craft item=crafting_table, then place item=crafting_table.'),
    M.craft('wooden_pickaxe', 1, 'Stone only drops cobblestone if mined with a pickaxe.',
            'Needs a crafting_table nearby.'),
    M.gather('cobblestone', 12, 'Now that you have a pickaxe.'),
    M.craft('stone_pickaxe', 1, 'Better tools last longer.', 'Needs a crafting_table nearby.'),
  ],

  // Bulk hand-mineable material. Deliberately simple, so it is the control
  // case: if THIS bot struggles, the problem is the skill layer, not the goal.
  gatherer: [
    M.gather('dirt', 16, 'Hand-mineable building material.'),
    M.gather('oak_log', 12, 'Wood too.'),
    M.gather('sand', 8, 'Found near water.'),
    M.gather('cobblestone', 8, 'Needs a pickaxe; expect this to be hard without one.'),
  ],
}

export const MILESTONES = MILESTONES_BY_ROLE.scout   // default / back-compat

/**
 * After the fixed chain there has to be something to DO.
 *
 * Completing the last milestone used to stop the cognitive loop, so the agent
 * stood motionless indefinitely -- correct by the letter of the design and
 * useless in practice, since the whole point (handoff doc S1) is an agent that
 * keeps operating without human instruction.
 *
 * These repeat forever with escalating targets, which also turns "how much did
 * it get done" into a countable number: cycles completed per hour.
 */
export const SUSTAINING = [
  {
    id: 'stockpile_wood',
    describe: n => `Stockpile ${8 + n * 4} oak logs.`,
    done: (b, n) => countItem(b, 'oak_log') >= 8 + n * 4,
    progress: (b, n) => `${countItem(b, 'oak_log')}/${8 + n * 4} oak_log`,
    hint: 'gather with block=oak_log.',
  },
  {
    id: 'stockpile_stone',
    describe: n => `Stockpile ${16 + n * 8} cobblestone.`,
    done: (b, n) => countItem(b, 'cobblestone') >= 16 + n * 8,
    progress: (b, n) => `${countItem(b, 'cobblestone')}/${16 + n * 8} cobblestone`,
    hint: 'gather with block=stone (needs a pickaxe), or mine to reach it.',
  },
  {
    id: 'patrol',
    describe: () => 'Scout terrain away from home and come back.',
    done: b => b.entity.position.distanceTo(
      { x: config.world.homeX, y: b.entity.position.y, z: config.world.homeZ }) > 80,
    progress: b => `${Math.round(b.entity.position.distanceTo(
      { x: config.world.homeX, y: b.entity.position.y, z: config.world.homeZ }))}/80 blocks out`,
    hint: 'goto somewhere 80+ blocks from home, staying inside the border.',
  },
  {
    id: 'return',
    describe: () => 'Return home with what you gathered.',
    done: b => b.entity.position.distanceTo(
      { x: config.world.homeX, y: b.entity.position.y, z: config.world.homeZ }) < 15,
    progress: b => `${Math.round(b.entity.position.distanceTo(
      { x: config.world.homeX, y: b.entity.position.y, z: config.world.homeZ }))} blocks from home`,
    hint: 'use the home skill.',
  },
]

export class MilestoneController {
  constructor(bot, role = config.bot.role, lessons = null) {
    this.bot = bot
    this.chain = MILESTONES_BY_ROLE[role] ?? MILESTONES_BY_ROLE.scout
    this.role = MILESTONES_BY_ROLE[role] ? role : 'scout'
    this.index = 0
    this.completedAt = {}
    this.lessons = lessons

    // Give-ups and effort survive restarts; completion does not (see
    // Lessons.getProgress). Without this, a bot that restarts -- and the
    // watchdog restarts one after three rescues -- begins its chain at
    // milestone 0 with a clean attempt counter every time, so an unreachable
    // goal is retried forever and the skip below can never accumulate enough
    // attempts to fire. Scout01 restarted nine times against the same
    // impassable hillside before this was wired up.
    const p = lessons?.getProgress?.() ?? { attempts: {}, skipped: [] }
    this.attempts = p.attempts
    this.skipped = p.skipped
  }

  #persist() { this.lessons?.setProgress?.(this.attempts, this.skipped) }

  current() { return this.chain[this.index] ?? null }

  /**
   * Give up on a milestone that cannot be advanced and move to the next.
   *
   * A goal can be genuinely impossible from where a bot stands -- Scout01's
   * "travel east" had no walkable route at all -- and without this the whole
   * chain stops behind it permanently. Skipping is recorded, not silent: a
   * skipped milestone is a finding about the world, not a success.
   */
  noteAttempt(failed) {
    const m = this.current()
    if (!m) return false
    this.attempts[m.id] = (this.attempts[m.id] ?? 0) + (failed ? 1 : 0)
    if (!failed) this.attempts[m.id] = 0
    if (this.attempts[m.id] >= 25) {
      if (!this.skipped.includes(m.id)) this.skipped.push(m.id)
      this.attempts[m.id] = 0
      this.index++
      this.#persist()
      return true
    }
    this.#persist()
    return false
  }

  /** Advance past every milestone whose predicate is now satisfied. */
  refresh() {
    let advanced = false
    while (this.index < this.chain.length) {
      const m = this.chain[this.index]
      let done = false
      try { done = m.done(this.bot) } catch { done = false }
      // Step over goals already proven unreachable in an earlier run, or the
      // restored give-up is worthless -- the chain would stall on them again.
      if (!done && !this.skipped.includes(m.id)) break
      // Only genuine completion gets a timestamp. A skipped goal is stepped
      // over, never recorded as done -- counting a give-up as a success would
      // corrupt every progress number drawn from this.
      if (done) this.completedAt[m.id] = Date.now()
      this.index++
      advanced = true
    }
    return advanced
  }

  status() {
    const m = this.current()
    if (!m) return { id: 'idle', describe: 'Nothing to do.', progress: '-', hint: '' }
    const n = this.cycle
    let progress = '-'
    try { progress = m.progress(this.bot, n) } catch { /* entity gone mid-respawn */ }
    const describe = typeof m.describe === 'function' ? m.describe(n) : m.describe
    return {
      id: this.index < MILESTONES.length ? m.id : `${m.id}#${n}`,
      describe, progress, hint: m.hint,
    }
  }

  get completedCount() { return this.index }
  get total() { return this.chain.length }
  get allDone() { return this.index >= this.chain.length }
}
