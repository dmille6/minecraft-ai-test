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

import { equivalentTools } from './skills.mjs'
import { bankableInventory } from './bankable.mjs'
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
// Calibrated against the 90 deposits actually recorded, measured from HOME
// (28,0) -- not from the origin. Measuring from 0,0 shifts every deposit by up
// to 28m and produced a confident, wrong conclusion that nothing existed beyond
// 100m; there are 13. Anything that computes a distance here must take home
// from config, which is why the test fixture now does too.
//
// The real distribution thins rather than stopping: 60m+ routine, 80m+ common,
// 100m+ real but rare (13 of 90), 140m+ never. At a 10-block step every bot
// stalls somewhere in the 90-110m band -- Gather02 at 7-beyond-90, Scout02 and
// Miner01 at 9-beyond-110 -- which is one genuine rung past its own record, and
// the ladders differ because the bots do.
//
// The ceiling is about what a scout can walk to and return from, not what is
// legal: the world border is 1950, and 250 is nearly 2x the fleet record.
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
    // `wants` is what the admission gate reads to decide an action may not
    // be hard-blocked: a producer of the thing this milestone needs must
    // always get an attempt, because an attempt is the only thing that can
    // clear the rule blocking it. Only `craft` set this, so the exemption was
    // unreachable for ~90% of active milestones -- measured: 0 firings
    // against 10 learned_avoid rejections in 40 minutes, while bots sat on
    // gather_oak_log_12 with `gather oak_log` blocked.
    //
    // Second-order effect, and it is the right one: classifyOutcome() reads
    // the same set, so gathering the block a milestone asked for now scores
    // `valuable` rather than `neutral`, and decrements its avoid rule. The
    // disproof channel was narrower than the accrual channel here too.
    wants: block,
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
   * from ambition, and measured from home rather than the origin: beyond 60m
   * every bot has found at least 16, beyond 80m the range is 8-18, and beyond
   * 100m it is 2-10. A goal nobody can reach is the same defect as a goal of
   * NaN, so every threshold here is one the fleet has already cleared.
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
    // SATISFIED BY CAPABILITY, NOT BY NAME. The note under M.travel below
    // already says why: a target that can be genuinely unreachable means the
    // milestone never completes and the bot loops on it forever. A bot holding a
    // STONE pickaxe has satisfied "craft a wooden pickaxe" in every sense that
    // matters, and refusing to say so left isolated-a-Alpha entombed for ten
    // hours with the materials for the better tool in its pockets.
    done: b => countItem(b, item) + equivalentTools(item)
                 .reduce((t, alt) => t + countItem(b, alt), 0) >= n,
    progress: b => {
      const exact = countItem(b, item)
      const better = equivalentTools(item).reduce((t, alt) => t + countItem(b, alt), 0)
      return better
        ? `${exact + better}/${n} ${item} (${better} of them better)`
        : `${exact}/${n} ${item}`
    },
    hint: hint ?? `craft with item=${item}.`,
  }),
  /**
   * A furnace rung. Same completion rule as M.craft -- satisfied by HOLDING the
   * output -- but it describes and hints the verb that can actually produce it.
   *
   * Reusing M.craft here would have been the cheaper diff and a lie the bot
   * reads every cycle: `craft item=iron_ingot` has no recipe the registry will
   * ever return, so the hint would name a move the model cannot make. This
   * project has shipped that mistake twice (place-as-escape, cherry_planks) and
   * both times the model dutifully took the impossible advice.
   */
  smelt: (output, input, n, why) => ({
    id: `smelt_${output}_${n}`,
    wants: output,
    describe: `Smelt ${n} ${output}. ${why}`,
    done: b => countItem(b, output) >= n,
    progress: b => `${countItem(b, output)}/${n} ${output} (${countItem(b, input)} ${input} to smelt)`,
    hint: `smelt with item=${input} — needs a furnace nearby and fuel (coal, charcoal or planks).`,
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
    M.survey(2, 100, 'Genuinely new ground -- only a handful of finds are this far out.'),
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

// THE TECH LADDER, AND WHY IT LIVES HERE RATHER THAN IN A ROLE CHAIN.
//
// 0 of 80 bots passed stone_pickaxe in 20 days, and the reason was not the
// model, the skills, the prompt or the pathfinder. NOTHING EVER ASKED THEM TO.
//
// The `gatherer` chain is four gather rungs and no craft rung at all -- by
// design, and the comment above it says so: "deliberately simple, so it is the
// control case". That was a sound diagnostic choice. Then every bot in the
// fleet was assigned BOT_ROLE=gatherer, and the control case became the whole
// experiment. The `miner` chain, which does drive wooden -> stone, is assigned
// to nobody. And even it terminates at stone_pickaxe: no chain has ever
// mentioned a furnace, coal or iron.
//
// So the ladder goes in SUSTAINING, which every role receives, rather than into
// one role's chain. Three properties make that safe:
//
//   * M.craft is SATISFIED BY CAPABILITY -- a bot holding an iron pickaxe has
//     already satisfied "craft a wooden pickaxe" (see the note on M.craft). So
//     each rung is a no-op for a bot already above it and only bites below.
//     The ladder self-advances and never re-does work.
//   * SUSTAINING repeats forever with escalating targets, so a bot that loses
//     its tools to a death is asked to rebuild them rather than carrying on
//     without.
//   * A rung that genuinely cannot be met is not a deadlock: the skip path
//     gives up after 25 attempts and backs off, which is the same protection
//     every other rung relies on.
//
// Ordered cheapest-first so a toolless bot is asked for wood before iron.
const LOGS = ['oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log',
              'dark_oak_log', 'mangrove_log', 'cherry_log']
const PLANKS = ['oak_planks', 'birch_planks', 'spruce_planks', 'jungle_planks',
                'acacia_planks', 'dark_oak_planks', 'mangrove_planks', 'cherry_planks']
const COBBLE = ['cobblestone', 'cobbled_deepslate', 'blackstone', 'stone',
                'andesite', 'diorite', 'granite', 'tuff']
// What a furnace will burn, restricted to what a Block-2 bot plausibly holds.
// Only ever used to decide whether the iron rung is ACTIONABLE; smelting.mjs
// owns the real fuel table and the burn times, and nothing here may disagree
// with it silently -- test/smelt-ladder.test.mjs asserts every name in this
// list actually burns according to that module.
const FUELS = ['coal', 'charcoal', ...PLANKS, ...LOGS]

/** Total of several item names in the inventory. */
const countAny = (b, names) => names.reduce((t, n) => t + countItem(b, n), 0)

/**
 * A ladder rung that DRIVES progress when it can and gets out of the way when
 * it cannot.
 *
 * `deposit_surplus` learned this the hard way and its note says it plainly: a
 * rung written as a bare requirement blocks the entire chain for a bot that
 * cannot meet it. Here that would be worse than merely stalled -- SUSTAINING is
 * the lap that produces the PRIMARY ENDPOINT, so a bot with no wood would burn
 * 25 attempts per rung against six rungs before returning to the gathering the
 * experiment actually measures.
 *
 * So: satisfied if the bot HAS the thing (capability, per M.craft), and
 * vacuously satisfied if it has no plausible means to make it. The rung fires
 * exactly when it is actionable, which is the only time asking is useful.
 */
const rungOf = (base, hasMeans) =>
  ({ ...base, done: (b, ...rest) => base.done(b, ...rest) || !hasMeans(b) })
const ladder = (item, n, why, hint, hasMeans) =>
  rungOf(M.craft(item, n, why, hint), hasMeans)
/** The same wrapper over a furnace rung, so iron obeys the identical rule. */
const smeltRung = (output, input, n, why, hasMeans) =>
  rungOf(M.smelt(output, input, n, why), hasMeans)

const TECH_LADDER = [
  ladder('crafting_table', 1, 'Tools need one nearby.',
         'craft item=crafting_table, then place item=crafting_table.',
         b => countAny(b, PLANKS) >= 4 || countAny(b, LOGS) >= 1),
  ladder('wooden_pickaxe', 1, 'Stone only drops cobblestone if mined with a pickaxe.',
         'Needs a crafting_table nearby.',
         b => countItem(b, 'crafting_table') >= 1 &&
              (countAny(b, PLANKS) >= 5 || countAny(b, LOGS) >= 2)),
  ladder('stone_pickaxe', 1, 'Better tools last longer, and iron needs one.',
         'Needs a crafting_table nearby.',
         b => countItem(b, 'crafting_table') >= 1 && countAny(b, COBBLE) >= 3 &&
              (countItem(b, 'stick') >= 2 || countAny(b, PLANKS) >= 2)),
  ladder('furnace', 1, 'Smelting needs one; 8 cobblestone.',
         'craft item=furnace, then place item=furnace.',
         b => countAny(b, COBBLE) >= 8),
  // IRON. The rung the ladder terminated one step short of; the note below this
  // array explains why it could not be added until `smelt` existed.
  smeltRung('iron_ingot', 'raw_iron', 1,
            'Raw iron is not a tool until a furnace has had it.',
            b => countItem(b, 'raw_iron') >= 1 && countItem(b, 'furnace') >= 1 &&
                 countAny(b, FUELS) >= 1),
  ladder('iron_pickaxe', 1, 'The tier above stone, and the fleet ceiling.',
         'Needs a crafting_table nearby: 3 iron_ingot + 2 stick.',
         b => countItem(b, 'crafting_table') >= 1 && countItem(b, 'iron_ingot') >= 3 &&
              (countItem(b, 'stick') >= 2 || countAny(b, PLANKS) >= 2)),
]

// IRON IS NOW ON THIS LADDER, AND THE NOTE THAT KEPT IT OFF STILL STANDS.
//
// What follows is the original note, unedited, because its argument was correct
// and the two rungs above satisfy it rather than overruling it. Read it first.
//
//   [ORIGINAL]
//
// Every rung above is a CRAFT gated on carrying the materials, so it is either
// immediately actionable or vacuously satisfied -- it can never cost a failed
// attempt. `gather iron_ore` is not like that. A well-equipped bot with no ore
// would fail it 25 times before the skip path fired, EVERY LAP of SUSTAINING,
// and SUSTAINING is the lap that produces the primary endpoint. That is a tax
// on the number the experiment exists to measure, paid by the bots that are
// doing best.
//
// So: ship the ladder that cannot cost anything, measure whether bots start
// reaching stone, and add iron once there is evidence the lower rungs are being
// climbed. The ceiling that mattered was "nothing ever asks for a pickaxe", and
// that is what these four fix.
//
//   [WHY THE RUNGS ABOVE ARE CONSISTENT WITH IT]
//
// The objection is precise and it is NOT "iron is too ambitious". It is that
// `gather iron_ore` is unlike every other rung: it can fail, so a well-equipped
// bot with no ore would burn 25 attempts on it EVERY lap of SUSTAINING, and
// SUSTAINING is the lap that produces the primary endpoint.
//
// Neither rung added above is a gather. Both go through `rungOf`, the same
// wrapper the four rungs below use, so both are VACUOUSLY SATISFIED unless the
// bot is already carrying everything the step needs:
//
//     iron_ingot    requires raw_iron AND a furnace AND fuel, in hand
//     iron_pickaxe  requires 3 iron_ingot AND sticks AND a table, in hand
//
// A bot with no ore never sees either rung; it is done the instant it is
// evaluated, costs no attempt, and the ladder moves on to the gathering the
// experiment measures. That is the exact property the note above demanded, and
// it is the property `gather iron_ore` could not have had.
//
// The other half of the note has also now been met. "Add iron once there is
// evidence the lower rungs are being climbed" -- 59 of 80 bots carry a furnace
// and 13 hold raw_iron, which is the furnace rung climbed and its output
// stranded. The rung below iron was not the ceiling. The missing VERB was: this
// fleet could craft a furnace and place a furnace and had no action that put
// anything into one, so `iron_ingot` had never existed, not once, in its
// history. That is what `smelt` fixes and what these two rungs now ask for.

export const SUSTAINING = [
  {
    id: 'stockpile_wood',
    describe: n => `Stockpile ${8 + n * 4} oak logs.`,
    done: (b, n) => countItem(b, 'oak_log') >= 8 + n * 4,
    progress: (b, n) => `${countItem(b, 'oak_log')}/${8 + n * 4} oak_log`,
    hint: 'gather with block=oak_log.',
  },
  // The ladder sits between wood and stone: a bot has just been asked for logs,
  // which is what the first rungs need, and cobblestone below needs the pickaxe
  // this produces. Spread rather than bunched, so one long ladder does not
  // starve the gathering the primary endpoint measures.
  ...TECH_LADDER,
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
    // THE CO-PRIMARY ENDPOINT NOBODY ASKED FOR.
    //
    // "deposited items per bot-hour" is co-primary in the pre-registration, and
    // until now no milestone requested a deposit. `return` below is scored on
    // POSITION -- a bot satisfies it by standing near home with a full inventory
    // and walking away. 647 deposit calls across 1.18M events were the model
    // choosing it unprompted.
    //
    // Placed AFTER `return` on purpose: the bot is already home by then, so this
    // costs the walk it was making anyway. The measured median distance from town
    // is 804 blocks and only 9% of samples are within 100, so a deposit goal that
    // fires anywhere would be a six-minute round trip through the travel failures
    // that already kill deposits.
    id: 'deposit_surplus',
    wants: null,
    describe: () => 'Put your surplus in the town chest before heading out again.',
    // SATISFIABLE EVEN WHEN IT CANNOT BE DONE, which is the whole lesson of the
    // note under M.travel below -- and which the first version of THIS rung got
    // wrong within an hour of me quoting it. Written as `count < 4` alone, a bot
    // carrying surplus with no chest in reach could never complete it and sat on
    // it for all 60 refreshes of survey.test.mjs, blocking the entire sustaining
    // chain forever.
    //
    // So the goal is "bank your surplus WHERE YOU CAN", and it is vacuously met
    // where you cannot: no storage within reach means there is nothing to do here
    // and the bot moves on. That also survives the town chest being destroyed,
    // which a strict version would not.
    done: b => {
      if (bankableInventory(b.inventory?.items?.() ?? []).count < 4) return true
      const chest = b.findBlock?.({
        matching: blk => ['chest', 'barrel', 'trapped_chest']
          .includes(b.registry?.blocks?.[blk.type]?.name),
        maxDistance: 48,
      })
      return !chest
    },
    progress: b => `${bankableInventory(b.inventory?.items?.() ?? []).count} bankable items carried`,
    hint: 'deposit — you are at the chest already; keep your tools and enough blocks to climb out.',
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
