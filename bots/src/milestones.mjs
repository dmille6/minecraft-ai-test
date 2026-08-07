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
import { log } from './logger.mjs'

// Role-specific chains. Three bots running the identical chain would fail in
// the identical way, which teaches us nothing beyond what one bot already
// showed. Different goals exercise different skills and surface different
// failure modes -- which is the point of running several.
//
// Every chain stays inside what the CURRENT skill set can actually achieve.
// An impossible goal produces failures that look like bad model judgement,
// which is the worst kind of confounder.

// The frontier moves out 10 blocks per completion and stops at 250.
//
// The step is calibrated against the 75 deposits the fleet has recorded, not
// picked for roundness. That distribution falls off a cliff: 60m+ is routine
// (Scout02 has 22), 70m+ is a stretch, 90m+ has been reached twice fleet-wide,
// and NOTHING has ever been recorded beyond 100m. A 20m step would have jumped
// straight from routine to never-achieved in two completions. At 10m each scout
// sits one genuine rung above its own record -- Scout01 at 5-beyond-70 having
// found 4, Scout02 at 7-beyond-90 having found 1 -- and the two ladders differ
// because the scouts do, which is the point of scouting them separately.
//
// The ceiling is about what a scout can walk to and return from, not what is
// legal: the world border is 1950, and 250 is already 2.5x the fleet record.
const SURVEY_STEP = 10
const SURVEY_MAX_DIST = 250
const surveyDist = lvl => Math.min(60 + lvl * SURVEY_STEP, SURVEY_MAX_DIST)
const surveyCount = lvl => 4 + lvl

/** Distinct deposits THIS bot has contributed to, beyond `minDist` from home. */
function countMySightings(worldFacts, minDist) {
  try {
    const rs = worldFacts?.read?.()?.resources ?? []
    const me = config.bot.name
    return rs.filter(r =>
      Array.isArray(r.by) && r.by.includes(me) &&
      Math.hypot(r.x - config.world.homeX, r.z - config.world.homeZ) >= minDist).length
  } catch { return 0 }
}


const M = {
  gather: (block, n, why) => ({
    id: `gather_${block}_${n}`,
    describe: `Collect ${n} ${block}. ${why}`,
    done: b => countItem(b, block) >= n,
    progress: b => `${countItem(b, block)}/${n} ${block}`,
    hint: `gather with block=${block}.`,
  }),
  /**
   * A scout's output is knowledge, not inventory.
   *
   * Scouts and gatherers were the same bot with different labels: skill
   * distribution showed `gather` and `goto` as the top two for both, in the same
   * proportions, and Scout01 crafted MORE than Gather01. The role name carried
   * no behavioural difference because both chains were measured in items.
   *
   * This one is measured in DISTINCT DEPOSITS this bot has personally found,
   * beyond a distance from home. Deposits merge within 24 blocks, so standing
   * next to one ore vein does not count twice -- covering ground does.
   *
   * Thresholds are set from what the fleet has actually achieved rather than
   * from ambition: beyond 60m every bot has found at least 9, beyond 80m the
   * range is 2-7, and beyond 100m the fleet has recorded NOTHING in its entire
   * history. A goal nobody can reach is the same defect as a goal of NaN -- the
   * 100m rung was exactly that, and is now 90m.
   */
  survey: (n, minDist, why, hint) => ({
    id: `survey_${n}_at_${minDist}`,
    wants: null,                       // deliberately not an item
    describe: `Find ${n} resource deposits at least ${minDist} blocks from home. ${why}`,
    done: (b, _cycle, wf) => countMySightings(wf, minDist) >= n,
    progress: (b, _cycle, wf) => `${countMySightings(wf, minDist)}/${n} deposits beyond ${minDist}m`,
    hint: hint ?? `explore, or goto a point ${minDist}+ blocks out; deposits are recorded automatically as you travel.`,
  }),

  craft: (item, n, why, hint) => ({
    id: `craft_${item}_${n}`,
    wants: item,
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
  // A scout that gathers wood and never uses it is a warehouse with legs.
  // Measured overnight: Scout02 accumulated 59 oak_log and Scout01 31 while
  // Miner01 -- the only role whose chain includes crafting -- held five dirt.
  // The materials and the job were in different bots, and until `withdraw`
  // existed there was no path between them at all.
  //
  // Giving scouts the first two crafting steps makes each one self-sufficient
  // for basic tools, which is what a scout operating away from base needs
  // anyway. Deeper tooling stays the miner's job.
  // A scout that gathers wood and never uses it is a warehouse with legs -- and
  // measuring it in items made it exactly that. Its chain is now mostly SURVEY
  // goals, which no other role has and which no amount of gathering satisfies.
  // Enough crafting remains to keep it self-sufficient on the road.
  scout: [
    M.gather('oak_log', 8, 'Enough wood to be self-sufficient out there.'),
    M.craft('oak_planks', 8, 'Carry your own materials.'),
    M.survey(6, 60, 'Map what is near the colony first.'),
    M.craft('stick', 4, '2 planks make 4 sticks.'),
    M.survey(4, 80, 'Push past the ground the gatherers already work.'),
    M.survey(2, 90, 'Genuinely new ground -- the fleet has found almost nothing this far out.'),
    // Scout-only, and at the END of the scout chain rather than in SUSTAINING.
    // SUSTAINING is appended to EVERY role, so putting it there handed a
    // gatherer "find 12 deposits beyond 100m" when NO deposit that far out had
    // ever been recorded by anyone -- an unreachable goal, on a gatherer, which
    // is both halves of what this change was meant to fix.
    {
      id: 'survey_wider',
      wants: null,
      // Escalates on ITS OWN completions, not the chain cycle: every time the
      // scout meets it, the frontier moves 20 blocks further out and it must
      // find one more deposit. Capped at SURVEY_MAX_DIST -- an escalator with no
      // ceiling eventually sets a goal nobody can reach, which this project has
      // shipped twice now.
      describe: (_n, lvl = 0) =>
        `Find ${surveyCount(lvl)} deposits at least ${surveyDist(lvl)} blocks from home.`,
      done: (b, _n, wf, lvl = 0) => countMySightings(wf, surveyDist(lvl)) >= surveyCount(lvl),
      progress: (b, _n, wf, lvl = 0) =>
        `${countMySightings(wf, surveyDist(lvl))}/${surveyCount(lvl)} beyond ${surveyDist(lvl)}m (level ${lvl})`,
      hint: 'explore, or goto a distant point; deposits record themselves as you travel.',
    },
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
const SKIP_RETRY_BASE_MS = 45 * 60 * 1000        // first retry 45 min after giving up
const SKIP_RETRY_MAX_MS  = 6 * 60 * 60 * 1000    // backs off, never past six hours

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
  constructor(bot, role = config.bot.role, lessons = null, worldFacts = null) {
    this.bot = bot
    // SUSTAINING was defined and never referenced. cognitive.mjs announces
    // "fixed milestone chain complete, entering sustaining loop" and chats
    // "tool chain complete -- switching to sustaining goals", but there was
    // nothing to switch TO: current() returned null off the end of the fixed
    // chain and the bot idled with "Nothing to do" permanently. All five bots
    // reached that state. Appending it is what those messages always meant.
    this.chain = [...(MILESTONES_BY_ROLE[role] ?? MILESTONES_BY_ROLE.scout), ...SUSTAINING]
    this.role = MILESTONES_BY_ROLE[role] ? role : 'scout'
    this.index = 0
    this.completedAt = {}
    this.lessons = lessons
    this.worldFacts = worldFacts

    // Give-ups and effort survive restarts; completion does not (see
    // Lessons.getProgress). Without this, a bot that restarts -- and the
    // watchdog restarts one after three rescues -- begins its chain at
    // milestone 0 with a clean attempt counter every time, so an unreachable
    // goal is retried forever and the skip below can never accumulate enough
    // attempts to fire. Scout01 restarted nine times against the same
    // impassable hillside before this was wired up.
    const p = lessons?.getProgress?.() ?? { attempts: {}, skipped: [], skippedAt: {}, skipCount: {} }
    this.attempts = p.attempts
    this.skipped = p.skipped
    this.skippedAt = p.skippedAt ?? {}
    this.skipCount = p.skipCount ?? {}
    // How many times the whole chain has been completed. SUSTAINING goals scale
    // their targets by it ("stockpile 16 + n*8 cobblestone"), and it was READ in
    // three places and ASSIGNED in none -- so every sustaining goal rendered as
    // "Stockpile NaN cobblestone", and done() could never be true because every
    // comparison against NaN is false. A bot reaching the sustaining loop was
    // handed a goal it was impossible to complete or to fail.
    //
    // Same defect as the death record that claimed "no skill running" from a
    // variable nothing set: read-but-never-written. Persisted, because a cycle
    // count is progress and a restart should not silently reset the difficulty.
    this.cycle = p.cycle ?? 0
    // How many times each milestone has genuinely been COMPLETED. Distinct from
    // `cycle`, which only advances on a full chain pass: a goal that should get
    // harder each time it is met needs to count its own completions, not wait
    // for every other goal in the chain to finish first.
    this.completions = p.completions ?? {}
  }

  #persist() {
    this.lessons?.setProgress?.(this.attempts, this.skipped, this.skippedAt, this.skipCount, this.cycle, this.completions)
  }

  /**
   * How long a give-up stands before the goal is worth another look.
   *
   * `skipped` used to only ever grow. Nothing removed an id, and it was
   * persisted across restarts, so a goal that was impossible ONCE was abandoned
   * for the life of the world. Miner01 spent its 25 attempts on
   * craft_wooden_pickaxe_1 while it held no planks and the craft skill was
   * naming an ingredient (cherry_planks) that does not occur here. Both of
   * those are fixed now; the give-up outlived the conditions that caused it,
   * and the bot sat idle holding 4 planks and 40 sticks -- a pickaxe and
   * change.
   *
   * The same missing inverse as the admission gate's failure counts, which now
   * decay. Retries back off, because a goal that keeps proving impossible
   * should cost less each time, not the same 25 attempts forever.
   */
  #skipExpired(id) {
    const at = this.skippedAt[id]
    if (!at) return true                       // no timestamp: pre-fix record, retry it
    const n = this.skipCount[id] ?? 1
    return Date.now() - at >= Math.min(SKIP_RETRY_BASE_MS * n, SKIP_RETRY_MAX_MS)
  }

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
    // A peer that already proved this unreachable lowers the cost of
    // confirming it -- but does NOT replace confirming it. Trusting a peer
    // outright would make one bot's bad conclusion permanent for the fleet,
    // which is exactly how the false drowning sites spread. Eight attempts is
    // enough to disagree with a peer that is wrong, and far cheaper than the
    // 25 each scout independently spent on the same goal tonight.
    const peers = this.worldFacts?.unreachableBy?.(m.id, config.bot.name, this.bot.entity?.position)
    const budget = peers ? 8 : 25
    if (this.attempts[m.id] >= budget) {
      if (!this.skipped.includes(m.id)) this.skipped.push(m.id)
      this.skippedAt[m.id] = Date.now()
      this.skipCount[m.id] = (this.skipCount[m.id] ?? 0) + 1
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

    // Expire give-ups whose cooldown has lapsed, so the scan below can land on
    // them again. Done before the scan, never during it.
    for (const id of [...this.skipped]) {
      if (!this.#skipExpired(id)) continue
      this.skipped = this.skipped.filter(x => x !== id)
      this.attempts[id] = 0
      log('info', 'milestone give-up expired, will try again', { milestone: id })
      this.#persist()
    }

    // RE-ENTER an exhausted chain. index only ever advanced, so running off the
    // end left current() returning null and the bot idle forever -- with real
    // work outstanding, because milestones are not permanent: crafting sticks
    // consumes the planks an earlier milestone produced, and a give-up that has
    // now expired is outstanding again. Re-scanning from the top costs one pass
    // over a list of about a dozen predicates.
    //
    // Guarded on something actually being incomplete, or this would reset the
    // index every cycle and never terminate.
    if (this.index >= this.chain.length) {
      const outstanding = this.chain.some(m => {
        if (this.skipped.includes(m.id)) return false
        try { return !m.done(this.bot, this.cycle ?? 0, this.worldFacts, this.completions[m.id] ?? 0) } catch { return false }
      })
      if (outstanding) {
        // Running off the end and finding work again is exactly one completed
        // pass, which is what the sustaining targets scale on.
        this.cycle += 1
        this.#persist()
        log('info', 'milestone chain re-entered; goals outstanding again', { cycle: this.cycle })
        this.index = 0
      }
    }

    while (this.index < this.chain.length) {
      const m = this.chain[this.index]
      let done = false
      try { done = m.done(this.bot, this.cycle ?? 0, this.worldFacts, this.completions[m.id] ?? 0) } catch { done = false }
      // Step over goals already proven unreachable in an earlier run, or the
      // restored give-up is worthless -- the chain would stall on them again.
      if (!done && !this.skipped.includes(m.id)) break
      // Only genuine completion gets a timestamp. A skipped goal is stepped
      // over, never recorded as done -- counting a give-up as a success would
      // corrupt every progress number drawn from this.
      if (done) {
        this.completedAt[m.id] = Date.now()
        this.completions[m.id] = (this.completions[m.id] ?? 0) + 1
        this.#persist()
      }
      this.index++
      advanced = true
    }
    return advanced
  }

  status() {
    const m = this.current()
    if (!m) return { id: 'idle', describe: 'Nothing to do.', progress: '-', hint: '' }
    // `?? 0` so a future regression degrades to an easy goal rather than an
    // impossible one. NaN is not a difficulty, it is a broken milestone.
    const n = this.cycle ?? 0
    let progress = '-'
    const lvl = this.completions[m.id] ?? 0
    try { progress = m.progress(this.bot, n, this.worldFacts, lvl) } catch { /* entity gone mid-respawn */ }
    const describe = typeof m.describe === 'function' ? m.describe(n, lvl) : m.describe
    return {
      // Fixed milestones keep their plain id; sustaining ones carry the cycle.
      // This compared against MILESTONES.length -- the SCOUT chain -- for every
      // role, so a miner's ids were suffixed against the wrong boundary.
      id: this.index < this.chain.length - SUSTAINING.length ? m.id : `${m.id}#${n}`,
      // What this milestone is actually FOR. The value classifier needs it:
      // without it, `inventory_gain` rewards gaining anything at all, and the
      // fleet converged on crafting sticks -- 80 of them, nothing needing more
      // than 2 -- because sticks were the most reliable way to make the number
      // go up. Productive-looking busywork is still not progress.
      wants: m.wants ?? null,
      describe, progress, hint: m.hint,
    }
  }

  get completedCount() { return this.index }
  get total() { return this.chain.length }
  get allDone() { return this.index >= this.chain.length }
}
