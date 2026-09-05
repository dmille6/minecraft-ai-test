// Reflex layer -- handoff doc S9.1.
//
// Runs continuously on a timer and never calls an LLM. Everything here is a
// survival response that must happen in under a second; routing any of it
// through a model would be both slower and less reliable.
//
// Reflexes may PREEMPT the running skill. That is the whole point: a bot
// calmly pathfinding into lava because it is "busy gathering" is the failure
// mode this layer exists to prevent.

import { log, logEvent } from './logger.mjs'
import { config } from './config.mjs'
import { announceHazard } from './comms.mjs'
import { isNight, snapshot, inventorySummary } from './state.mjs'
import { breathable, makeAirClock, airEmergency } from './air.mjs'
import { dropsOf } from './drops.mjs'
import { harvestSafe, stairUpStep, chooseStairUpBearing, headroomBreach,
         bodyPassable, isFallingBlock } from './scaffold.mjs'
import { planDig, predictedDigMs } from './digbudget.mjs'
import { mayHarvestUnderfoot } from './mining.mjs'
import { Vec3 } from 'vec3'
import pathfinderPkg from 'mineflayer-pathfinder'
const pkgGoals = pathfinderPkg?.goals

const FOOD_PRIORITY = [
  'golden_carrot', 'cooked_beef', 'cooked_porkchop', 'cooked_mutton',
  'cooked_chicken', 'bread', 'baked_potato', 'cooked_cod', 'cooked_salmon',
  'apple', 'carrot', 'melon_slice', 'sweet_berries',
]

// What is worth remembering the location of. Kept short: every entry costs a
// findBlocks call per survey tick, and the point is a sparse map of
// opportunities, not an index of the world.
const SURVEY_BLOCKS = [
  'oak_log', 'birch_log', 'spruce_log',
  'stone', 'coal_ore', 'iron_ore',
  'sand', 'water',
]

const DANGER_BLOCKS = new Set(['lava', 'fire', 'campfire', 'soul_fire', 'magma_block'])

// Escape pacing. Both of these were USED by the entombment escape in 3073a9f
// and never DECLARED, along with lastEscapeAt and escapeFailures below.
//
// The cost of that: `lastEscapeAt is not defined` threw out of the reflex
// interval callback on every single tick, twice a second, which killed the
// WHOLE reflex layer -- drowning, lava, low health, low oxygen, stuck, all of
// it -- while the bots looked alive and kept making LLM calls. A reflex layer
// that throws is worse than no reflex layer, because everything downstream
// still assumes it is watching.
//
// `node --check` does not catch this: an undeclared identifier is a runtime
// ReferenceError, not a parse error. Only executing the branch finds it, and
// this branch needs a bot to actually be entombed. See README "things that
// cost a debugging cycle".
const ESCAPE_MIN_INTERVAL_MS = 15_000   // > a full escape attempt, so a failure is not retried instantly
const ESCAPE_GIVE_UP_AFTER = 4          // then hand it to the watchdog, which can relocate/home/reconnect
// How often the marooned check may run a pathfinder search. Long, because a bot
// that cannot leave will still be unable to leave in a minute, and the check is
// the expensive kind: a real search rather than a block lookup.
const MAROON_CHECK_MS = 60_000
// A trapped bot with no blocks cannot fix itself, so the ask must not repeat
// every check -- applyPrereq needs time to make it the task and gather.
const MAROON_PREREQ_COOLDOWN_MS = 120_000

/**
 * What a drowning release actually WAS.
 *
 * Both exits -- reaching land, and the 20s ownership ceiling expiring -- used to
 * release the body under one `drowning_escaped` event, so a bot still floating
 * mid-lake recorded the same success as one standing on a beach. Over fourteen
 * hours `_drowning_route` and `_drowning_escaped` arrived in near-equal pairs
 * (3,334 / 3,329) while bots stayed pinned in water: the pairs were the loop
 * restarting, and the shared name hid it.
 *
 * The ceiling still releases -- holding a body that cannot be saved starves
 * every other reflex -- but only reaching ground that is not water is an escape.
 */
/**
 * What a drowning release actually WAS, and the third outcome it could not say.
 *
 * Both exits -- reaching land, and the 20s ownership ceiling expiring -- used to
 * release the body under one `drowning_escaped` event, so a bot still floating
 * mid-lake recorded the same success as one standing on a beach. Over fourteen
 * hours `_drowning_route` and `_drowning_escaped` arrived in near-equal pairs
 * (3,334 / 3,329) while bots stayed pinned in water: the pairs were the loop
 * restarting, and the shared name hid it.
 *
 * Splitting escape from timeout fixed the lie but flattened two very different
 * failures into one counter. A bot that ran the ceiling down while SWIMMING AT A
 * BANK failed at execution; a bot that surfaced, breathed, and found no shore in
 * any direction never had a rescue to execute. Both logged
 * `drowning_released_timeout`, so the 14.1% escape rate could not say which one
 * the fleet was actually suffering -- and they want opposite fixes.
 *
 * So there are three kinds now, and the ceiling still releases: holding a body
 * that cannot be saved starves every other reflex.
 *
 * WHY LANDING IS STILL THE ESCAPE CRITERION. The obvious "fix" to a bad escape
 * rate is to call surfacing an escape -- the bot is breathing, after all. That
 * is a metric fix, not a bot fix. A bot floating with full lungs has not got out
 * of the water: cognition resumes, re-proposes the same crossing, and the reflex
 * fires again. That loop is already in this file's history at 300+
 * `drowning_route` firings per bot-hour. Renaming it would have moved the number
 * without moving a single bot. The three kinds are logged distinctly so the
 * ANALYSIS can choose its definition; the reflex does not choose for it.
 */
export function drowningRelease () {
  // ONE OUTCOME. The three kinds this used to return -- `drowning_escaped`,
  // `drowning_surfaced_stranded`, `drowning_released_timeout` -- were three
  // ways of grading a rescue against LAND, and two of them were failures only
  // because the bot was still wet. A rescue that ends with the bot breathing
  // succeeded. Where it is standing is not the reflex's business.
  return { kind: 'drowning_breathing', status: 'success', escaped: true, landed: false }
}

/**
 * The four-way marooned decision, as a value rather than a nested condition.
 *
 * `need_scaffold` is the case that did not exist. The branch required
 * `haveBlocks` and had no else, so a bot that could not start a path, with an
 * open column overhead and an empty inventory, produced NOTHING -- no event, no
 * prerequisite, no log line. The most trapped state the system can reach was
 * the only one that was silent, which is a large part of why `_prereq_adopted`
 * fired 73 times against 1,601 trap events.
 *
 * The reflex cannot resolve it either way: acquiring dirt is planning work at
 * the cognitive cadence, not something to do while owning the body at 500ms. So
 * the trapped-without-blocks case publishes a prerequisite and lets applyPrereq
 * make it the task.
 */
/**
 * The overworld build limit is y=320, so ABOVE THE TERRAIN "up is open" is
 * always true and stays true no matter how far the bot climbs. Two bots reached
 * y=320.5 and y=320 and logged
 *
 *     no path can start from y=320 with an open column above -- climbing out
 *
 * 163 times in three hours, pillaring against the ceiling of the world. The
 * condition that triggers a climb -- open column, no route from here -- is
 * satisfied perfectly by a bot standing on a one-block tower in the sky, and
 * climbing is the one thing that cannot help it.
 *
 * A bot that high is not trapped under something; it is stranded above
 * everything, and the direction it needs is down. The reflex cannot plan a
 * descent at 500ms, so this is published rather than acted on.
 *
 * The ceiling is generous: the pregenerated terrain around the town sits near
 * y=73 and the tallest overworld peaks reach ~256, so 200 cannot be mistaken
 * for legitimate mountain travel while still catching the sky-pillar case by a
 * wide margin.
 */
export const CLIMB_CEILING = 200

export function maroonState({ upIsOpen, haveBlocks, entombed, canStartPath,
                              cappedNeedsTool = false, y = null,
                              climbCeiling = CLIMB_CEILING,
                              blockCount = null, climbNeed = 24 }) {
  if (!upIsOpen || entombed || canStartPath) return 'none'
  // Checked BEFORE the block/tool branches: a bot at the build limit with a
  // full inventory of dirt is not one scaffold away from rescue, and asking it
  // for more blocks -- which `need_scaffold` does -- sends the cognitive layer
  // to gather materials for a tower that cannot go anywhere.
  if (typeof y === 'number' && y >= climbCeiling) return 'stranded_high'
  if (haveBlocks && cappedNeedsTool) return 'need_pickaxe'
  // `haveBlocks` IS A `.some()` TEST AND THE CLIMB NEEDS TWENTY-FIVE.
  //
  // One placeable block flipped this to 'climb', and `pillarOut` then refused via
  // `canFinishClimb`, which wants `PILLAR_MAX_BLOCKS + 1`. Every bot holding
  // 1..24 blocks was therefore routed to a remedy guaranteed to decline, instead
  // of to `need_scaffold` -- the branch that ASKS FOR WHAT IS MISSING and is the
  // only one of the two that can ever change the situation.
  //
  // `blockCount` is optional so existing callers keep working; when it is absent
  // the old boolean behaviour stands, because a caller that cannot count is not
  // evidence that the bot has too few.
  if (typeof blockCount === 'number' && haveBlocks &&
      !canFinishClimb({ have: blockCount, need: climbNeed })) return 'need_scaffold'
  return haveBlocks ? 'climb' : 'need_scaffold'
}

/** The scaffold ask, shared with climbPrerequisite('no scaffold') by intent:
 *  a bot rescued by the reflex and one rescued through `surface` must request
 *  exactly the same thing, or the two paths teach the fleet different lessons. */
export function scaffoldPrereq(because) {
  return {
    items: ['dirt', 'cobblestone', 'stone', 'andesite', 'diorite',
            'granite', 'gravel', 'netherrack'],
    count: 8,
    describe: 'Gather 8 dirt or cobblestone. You are trapped and need blocks in hand to pillar out.',
    because,
  }
}

export function pickaxePrereq(because) {
  return {
    items: ['wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'diamond_pickaxe'],
    count: 1,
    describe: 'Get a pickaxe. The stone above you cannot be broken without one.',
    because,
  }
}


// At tickMs=500 these are 5s to raise the alarm and 30s to give up -- long
// enough that a transient world/pathfinder hiccup does not trip them, short
// enough that a dead reflex layer is measured in seconds rather than hours.
const REFLEX_ERROR_ALARM = 10
const REFLEX_ERROR_GIVE_UP = 60

/**
 * Shared throttle for every reflex.
 *
 * Five reflexes have now thrashed and each was fixed individually. The
 * generalisation: NO reflex should fire more than once per interval per kind.
 * A condition still true after acting on it is either not fixable by that
 * reflex or needs escalation -- in both cases hammering it 50 times a minute
 * only floods the telemetry everything else is measured from.
 *
 * Defined outside startReflexes so a reflex added tomorrow gets it for free.
 */
/**
 * Report items the REFLEX layer consumed.
 *
 * Reflexes act outside the task runner, so nothing they spend appears in any
 * `skill.inventory_delta` -- a bot pillaring out of a pit burns blocks with no
 * record at all. That is not just a reporting hole: ADR-0003's value classifier
 * decides `valuable` / `costly` FROM those deltas, so unmeasured reflex
 * consumption means the fleet is being reinforced on incomplete accounting.
 *
 * Emitted as its own event with an explicit cause, so every inventory change is
 * either attributed or visibly unattributed.
 */
function noteReflexInventory(bot, before, cause) {
  try {
    const after = inventorySummary(bot)
    const delta = {}
    for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const d = (after[k] ?? 0) - (before[k] ?? 0)
      if (d !== 0) delta[k] = d
    }
    if (!Object.keys(delta).length) return
    logEvent({
      kind: 'inventory_mutation', status: 'success',
      detail: `cause=${cause} ${Object.entries(delta).map(([k, n]) => `${k} ${n > 0 ? '+' : ''}${n}`).join(', ')}`,
      snapshot: snapshot(bot),
    })
  } catch { /* accounting must never break a rescue */ }
}

/**
 * WHAT IS HAPPENING TO THIS BOT'S AIR -- as a pure function of its state.
 *
 * Extracted from the reflex loop deliberately. Every one of the three drowning
 * bugs fixed on 2026-08-07 lived in a branch that could only be reached by a
 * live bot underwater, which is why each took a deploy, a fleet restart and a
 * measurement window to find:
 *
 *   1. the oxygen counter was trusted over the world, so a stale reading
 *      suppressed real drownings
 *   2. isEntombed() counted water as a wall, so the entombment escape held the
 *      serial reflex loop for 20-30s while the bot drowned
 *   3. the rescue was gated behind a log-spam throttle that the preceding
 *      condition consumed -- `reflex: drowning` fired 0 times across 17 deaths
 *
 * All three are one-line assertions against this function. None of them needed
 * a server.
 *
 * @returns {{losing: boolean, kind: 'drowning'|'suffocating'|null,
 *            act: 'swim'|'fallthrough'|'none', suspect: boolean}}
 *   losing   -- air is genuinely going
 *   kind     -- what to call it in telemetry
 *   act      -- swim up, or fall through to the entombment handler
 *   suspect  -- the counter says one thing and every other signal disagrees
 */
// THE AIR THRESHOLD IS A FRACTION, BECAUSE THE UNITS ARE NOT WHAT THE DOCS SAY.
//
// mineflayer documents `oxygenLevel` as bubbles, 0-20. This build reports the
// raw air TICK counter instead. Measured over 1,222 logged values:
//
//     min -1   max 400   and 192 of them above 20
//
// I set this to 10 believing it was bubbles -- "about seven seconds of air".
// On a 400-tick scale, 10 ticks is HALF A SECOND. The rescue was starting with
// half a second of air and then being asked to swim a median of 3 blocks and up
// to 15, which is why bots surfaced perfectly 435 times out of 435 and still
// drowned: the ones that died never had time to arrive. The 20-tick-per-second
// drain meant a bot fell in with full air and got no reflex at all for fifteen
// seconds.
//
// So do not hardcode a number in either unit. `airMax` is the largest value this
// bot has actually reported -- it sits at full on land, which is most of the
// time -- and the trigger is a fraction of it. That self-calibrates to a 0-20
// build and a 0-400 build alike, and cannot be silently wrong again.
export function assessAir(bot, { maxHealth = 20, airMax = 300, lowAirFrac = 0.4, prevOxygen = null } = {}) {
  // Floor of 4 so a bot that has somehow only ever reported small values still
  // gets a rescue rather than a threshold of zero.
  const lowOxygen = Math.max(4, Math.round(airMax * lowAirFrac))
  const none = { losing: false, kind: null, act: 'none', suspect: false }
  const ox = bot?.oxygenLevel
  if (ox == null || ox > lowOxygen) return none

  const head = bot.blockAt?.(bot.entity.position.offset(0, 1, 0))
  const headSolid = head != null && head.boundingBox === 'block'
  // Health is the one value the SERVER owns. blockAt() is a client-side view and
  // it disagrees with the server about water exactly when it matters most, which
  // is why entity.isInWater is consulted at all.
  const losingHealth = bot.health != null && bot.health < maxHealth

  // WADING IS NOT DROWNING, AND THE TEST IS THE TREND.
  //
  // entity.isInWater is true for a bot standing in a shallow pond with its head
  // in open air. Air does not drain when your head is above the surface, so
  // that bot loses nothing -- but the reflex fired anyway, aborted whatever
  // skill was running, and did it again on the next tick. Measured on
  // fleet-028: 2,278 drowning escapes per HOUR, every one logging
  // `head=air health=20`, with goto down to 4% success -- not because pathing
  // failed but because it was being interrupted. Solo02 logged 258 in fifteen
  // minutes at a mean y of 62, which is the surface.
  //
  // The obvious fix -- stop believing isInWater when the head block is air --
  // would undo a lesson this file already paid for: blockAt is a client-side
  // view and it disagrees with the server about water exactly when it matters
  // most, so a genuinely submerged bot can read `head=air` and drown while we
  // congratulate ourselves.
  //
  // Both are true. What separates them is neither the block nor the health, it
  // is whether the counter is actually MOVING. Wading holds oxygen pinned at
  // full; drowning drains it. A trend needs no absolute scale either, so it
  // sidesteps the bubbles-vs-ticks confusion that caused the original bug.
  //
  // `prevOxygen` is optional: without it this behaves exactly as before, which
  // keeps the pure function honest for callers that have no history.
  // A MARGIN, because the counter is noisy. Readings oscillate by one between
  // ticks even on dry land, so "lower than the last sample" fires constantly:
  // the first version of this gate left the rate at 1,881 escapes/hour because
  // a 20 -> 19 flicker read as draining. `prevOxygen` is the recent PEAK, and
  // real drowning falls away from it fast and keeps going, so a couple of units
  // of slack costs nothing on the cases that matter.
  const DRAIN_MARGIN = 2
  if (prevOxygen != null && ox >= prevOxygen - DRAIN_MARGIN && !losingHealth) {
    return { losing: false, kind: null, act: 'none', suspect: true }
  }

  const inWater = head?.name === 'water' || bot.entity?.isInWater === true

  if (!(inWater || headSolid || losingHealth)) {
    // Low air, clear head, full health: the counter disagrees with everything.
    return { losing: false, kind: null, act: 'none', suspect: true }
  }
  return {
    losing: true,
    kind: inWater ? 'drowning' : 'suffocating',
    // Swim whenever the head is not in stone. Digging is the only remedy the
    // fall-through path knows, and it is the wrong one in water.
    act: (inWater || (losingHealth && !headSolid)) ? 'swim' : 'fallthrough',
    suspect: false,
  }
}

/**
 * MAY THIS DETECTION TOUCH THE BODY?
 *
 * Detection and consequence are different questions and tonight proved they
 * need different bars. Three attempts to tune the DETECTOR each failed
 * differently -- 2278/hr, then 1881, then 344-524, then 2086 when a "better"
 * split let head=water fire at full air -- because the input cannot be made
 * reliable: bot.oxygenLevel arrives on two scales intermittently (bubbles 0-20
 * and ticks up to 400), so any absolute threshold, peak or median can be
 * poisoned by a sample from the other scale.
 *
 * So stop trying. Detection may stay noisy and keep logging, because a log line
 * costs nothing. What must NOT happen on a bad reading is the expensive part:
 * runner.interrupt() cancels the running skill and seizeBody() clears every
 * control state, which stops a walking bot mid-stride. That coupling is why
 * goto sat between 3% and 9% all night while the bots were physically fine.
 *
 * Two forms of evidence a unit artefact cannot fake:
 *
 *   HEALTH FELL SINCE THE LAST SAMPLE. Note "since the last sample", not
 *   "below maximum" -- a bot that took fall damage an hour ago and has not
 *   regenerated would otherwise satisfy the gate forever.
 *
 *   OXYGEN IS MONOTONE NON-INCREASING with at least one real decrease across
 *   the recent samples. A genuine drain looks like [20,19,19,18]: plateaus are
 *   expected, because the reflex ticks at 500ms and Minecraft drains about one
 *   unit per second. Scale alternation looks like [400,20,400,20] -- it goes
 *   back UP, which draining air never does.
 */
/**
 * Has the bot actually started BREATHING again, as opposed to merely stopped
 * getting worse?
 *
 * Exported and pure for the same reason airConsequenceEvidence is: the decision
 * that matters must be assertable without a server, or it only gets tested by
 * losing a bot. See drowning-floor.test.mjs for the fourteen false escapes this
 * exists to prevent.
 *
 * @param oxNow   current counter, either scale (bubbles 0-20 or ticks 0-400)
 * @param recent  oldest-first window of recent readings
 * @param airMax  the largest value this bot has actually reported
 */
export function breathingAgain(oxNow, recent = [], airMax = 300) {
  const lowOx = Math.max(4, Math.round(airMax * 0.4))
  // recent[0] is the oldest of the window, so this asks "has it come back up",
  // not "did it avoid dropping since the last tick".
  const oxRising = oxNow != null && recent.length >= 2 && oxNow > recent[0]
  // A null counter still releases: unknown must not mean the body is held
  // forever, which is the bug the release was added for in the first place.
  return oxNow == null || oxNow > lowOx || oxRising
}

export function airConsequenceEvidence(bot, air, { oxygenSamples = [], previousHealth = null,
                                                   airMax = 20, criticalFrac = 0.25,
                                                   head = null } = {}) {
  const h = bot?.health
  const healthDropped = h != null && previousHealth != null && h < previousHealth

  // THE FLOOR CASE, AND WHY IT SITS ABOVE THE `losing` RETURN.
  //
  // assessAir reports losing=false in two OPPOSITE situations, and this file has
  // said so for weeks: oxygen pinned at FULL (wading) and oxygen pinned at the
  // FLOOR, where the counter has nothing left to drain. Everything below this
  // block returns false for the second case, so the rescue layer was provably
  // blind to it -- two bots sat entombed for five hours logging "air fell to 6%
  // (20/320); rescuing=false" while nothing ever fired.
  //
  // But hoisting a bare `oxygen <= 25%` above the return is worse than the bug.
  // A bot standing in dry air with a stale reading would be seized and never
  // released, because breathingAgain() reads flat-low as "not breathing". This
  // project already logs `oxygen_reading_suspect`, so bad readings are known to
  // occur.
  //
  // So the floor case requires the air to be low AND the world to agree: in
  // water, head in water, head sealed, or health actually dropping. Two of those
  // are physics, one is a block read, one is damage. A stale number alone is not
  // evidence of drowning.
  const ox = bot?.oxygenLevel
  const critical = typeof ox === 'number' && airMax > 0 && ox <= airMax * criticalFrac
  if (critical) {
    const headName = head?.name
    const environmental =
      bot?.entity?.isInWater === true ||
      headName === 'water' || headName === 'bubble_column' ||
      (head != null && head.boundingBox === 'block') ||
      healthDropped
    if (environmental) return true
  }

  if (!air?.losing) return false

  if (healthDropped) return true

  // NEARLY OUT OF AIR OUTRANKS THE TREND TEST, AND 23 BOTS DIED PROVING IT.
  //
  // The monotonic check below returns false the moment ANY sample in the window
  // ticks upward. That is correct noise-rejection for a bot wading in and out of
  // a stream. It is lethal for a bot CYCLING: surface, breathe, sink, repeat --
  // every cycle writes an up-tick into the window, so the rescue refuses to act
  // on the way back down. Measured after the release-into-idle change made
  // cycling common (drowning_reentry 0 -> 30.3 per bot-hour), refusals rose to
  // 33.9% of drowning detections and drowning deaths tripled to 0.143/bot-hour.
  //
  // The pre-death traces are unambiguous: `_air_drowning_observed` -- the kind
  // logged when this function says no -- appearing 0.1s before a death at
  // "oxygen 20, head block water, health 1.33".
  //
  // So: below a quarter of a tank, the trend does not get a vote. This cannot
  // fire for a wading bot, because a wading bot is not at 25% air.

  const s = (oxygenSamples ?? []).filter(v => typeof v === 'number')
  if (s.length < 2) return false
  let down = 0
  for (let i = 1; i < s.length; i++) {
    if (s[i] > s[i - 1]) return false        // it went back up: not a drain
    if (s[i] < s[i - 1]) down++
  }
  return down > 0
}

/**
 * WHERE IS THE NEAREST AIR, AND CAN THE BOT REACH IT?
 *
 * The drowning rescue held `jump` and nothing else, which swims a bot straight
 * up. That is right in open water and useless under a ceiling -- and EVERY
 * drowning death on the rebuilt world was underground: y=48 to 56 against a sea
 * level of 63, scattered over 125 blocks of x. Flooded caves, not ocean.
 *
 * So the bot swam into stone and drowned while the reflex correctly re-reported
 * `drowning` every 8 seconds. The diagnosis was right and the cure was chosen
 * from a proxy -- "head is in water" implies "up is air" -- rather than from the
 * condition that decides whether swimming up can possibly work.
 *
 * Straight-line scans only. This runs every 500ms on a bot that has roughly ten
 * seconds to live, so it must be cheap and it does not need to be optimal: any
 * air beats the ceiling it is currently pressed against.
 *
 * Returns { dir: 'up' | 'out' | null, target, dist }.
 *   up   -- open column overhead; hold jump, as before
 *   out  -- capped above but air reachable sideways; steer at it
 *   null -- sealed in on every axis scanned; nothing here will save it
 */
// maxUp is deliberately generous: a bot on an ocean floor at y=48 is fourteen
// blocks under the surface, and swimming up is correct at any depth so long as
// the column is clear. maxOut is small because sideways swimming is a gamble --
// it is the fallback for when up is provably sealed, not a search.
/**
 * The nearest block this bot could STAND on -- which is not the same question
 * as the nearest air, and that difference is the whole bug.
 *
 * `breathableRoute()` answers "where can I breathe" and correctly returns
 * {dir:'up', dist:1} for anything just under a surface; drowning-cave.test.mjs
 * asserts that on purpose, because in a flooded cave air IS the emergency exit.
 * But the rescue is only RELEASED by `ashore()`, which requires standing on
 * ground that is not water. So the escape pursued one place and was graded on
 * another, and a bot that surfaced simply floated until the 20s ownership
 * ceiling expired: 2,113 timeouts, at oxygen 399-400 out of ~400 and health 20.
 * Those bots were not drowning. They were safe, wet, and holding the body of a
 * rescue that could never end -- roughly 11.7 fleet-hours of it, interrupting
 * every travel skill they attempted.
 *
 * Block reads only, no pathfinding: this runs inside a 500ms tick that also
 * owns health, hunger, entombment and stuck detection. It answers one narrow
 * question -- "is there something I could stand on if I swam at it" -- and if
 * the answer is no, open water stays an honest failed rescue.
 */
/**
 * What the body should do this tick, as a value rather than three scattered
 * setControlState calls.
 *
 * Extracted so the FORWARD=FALSE branch is testable. That branch is where the
 * bug lived: for any non-'out' route the old code set forward=false and held
 * jump, which is a vertical surface-hold -- exactly the behaviour that produced
 * a floating bot with full lungs and a rescue that never ended.
 */
/**
 * Does a bot NOBODY IS STEERING need its head held above water?
 *
 * Extracted as a value because the alternative is a source-grep test, and a
 * source-grep test is what let `bot.waterMovements` ship as dead code: those
 * assertions checked that the profile was CONFIGURED correctly and nothing
 * checked that anything consumed it. The lesson generalises -- assert on the
 * decision, not on the text that produces it.
 *
 * The three exclusions are ownership, not safety. A rescue, a deliberate
 * crossing, or standing on dry land each mean somebody else is already
 * responsible for this body; only the unowned-and-afloat case is ours.
 */
/**
 * Has the bot ENTERED or LEFT physically-critical air, independent of whether
 * anything chose to act on it?
 *
 * A GATE MUST NOT MEASURE ITS OWN TRIGGER. The critical-oxygen override added in
 * b6a4845 acts below 25% air, so gating Block 2 on "how often was air critical"
 * would be counting that mechanism rather than the world -- and tuning the
 * override would move the number whether or not a single bot was safer. That is
 * the escape-rate mistake wearing a different hat, and it is the reason this
 * lives in its own function with no knowledge of mayAct, rescuing, or swimming.
 *
 * Two thresholds, not one: a bot hovering at the line would otherwise emit a
 * stream of entries and inflate the very rate the gate reads.
 *
 * Returns 'enter' | 'clear' | null (no transition).
 */
export function airCriticalTransition(oxygen, airMax, latched,
                                      { enter = 0.25, clear = 0.5 } = {}) {
  if (typeof oxygen !== 'number' || !(airMax > 0)) return null
  const frac = oxygen / airMax
  if (frac <= enter && !latched) return 'enter'
  if (frac > clear && latched) return 'clear'
  return null
}

/**
 * WHAT A BODY IN WATER MUST DO, AND IT IS NOT "ESCAPE".
 *
 * Water is terrain. Swimming is a mode of travel, not a danger to react to, and
 * this function must never grow back into an escape instinct. What a body in
 * water owes is one thing: keep its head up. That is not a rescue and it is not
 * a policy about where to go.
 *
 * THE BUG THIS REPLACES, measured on a canary and rolled back: the previous
 * version asked `isWet(feet)` with a WIDE definition that counted kelp and
 * seagrass, then pressed `jump` and nothing else. In kelp the old-old code did
 * nothing; the wide version made the bot tread water in place, and treading
 * water is the measured killer -- 4 drownings in 26 bot-hours against 8 in 365
 * control bot-hours, p ~ 0.003.
 *
 * So the two questions are separated, permanently:
 *
 *   AM I IN WATER   -> narrow. Actual water. Kelp is a plant growing in water,
 *                      and standing beside it is not swimming.
 *   CAN I BREATHE   -> broad. Kelp, seagrass and waterlogged blocks all fill a
 *                      head space with water. See air.mjs `breathable()`.
 *
 * And the action always carries a direction:
 *
 *   'float'        head in air. Hold up. This is what floating IS.
 *   'surface'      head under, air above. Rise -- up is the direction.
 *   'surface_out'  head under, air only sideways. Rise AND steer to it.
 *   'no_air_route' head under, nothing reachable. Say so; do not mime a fix.
 */
export function waterPosture ({ owned, ashore, feet, head, route = null } = {}) {
  if (owned || ashore) return false
  // Narrow, and it stays narrow. This is the trigger, not the air test.
  const inWater = !!feet && (feet.name === 'water' || feet.name === 'bubble_column')
  if (!inWater) return false
  // 'float' STAYS, and it is worth writing down why, because it looks like the
  // thing this change deletes and it is not.
  //
  // This branch fires only for an UNOWNED bot -- one running no skill. An idle
  // entity in water sinks, and holding its head up is life support with a
  // measured ablation behind it. It expresses no opinion about where the bot
  // should be; it does not scan, steer, or prefer dry ground.
  //
  // What was deleted was the opposite: a rescue that SEIZED a busy bot and
  // drove it at a beach. Removing 'float' as well would bundle an unproven
  // behavioural change into a deletion that is otherwise clearly correct, in
  // exactly the place where widening or narrowing a water predicate has
  // already cost three rollbacks (kelp, global demotion, stale goals). If
  // 'float' is wrong it deserves its own canary, not a free ride on this one.
  if (breathable(head)) return 'float' 
  const dir = (typeof route === 'function' ? route() : route)?.dir ?? null
  if (dir === 'up') return 'surface'
  if (dir === 'out') return 'surface_out'
  return 'no_air_route'
}

export function drowningControls ({ losing, route }) {
  // THE ONLY THING A DROWNING BOT IS OWED IS AIR.
  //
  // This function used to have a second phase: breathing, not ashore, so swim
  // to a bank. That phase is deleted. It graded a rescue on reaching LAND,
  // which is a goal the bot never had -- swimming is a way of moving, not a
  // condition to be cured -- and the ledger for it was:
  //
  //     _drowning_to_shore            281,080
  //     _drowning_swim_to_known_land   59,662
  //     _drowning_no_shore             92,845
  //     _drowning_escaped              32,231   <- the only success kind
  //     _drowning_surfaced_stranded    74,102
  //     _drowning_released_timeout    102,779
  //     _drowning_reentry             144,356
  //
  // 32,231 successes against 176,881 failed releases and 144,356 bots that
  // turned around and swam back in, because being in water was never a problem
  // to begin with. Everything past `losing` is gone with it.
  //
  // `route.dir === 'out'` SURVIVES and is load-bearing: 18,672 routes went
  // sideways, 88.9% of them at y=30-49, in flooded caves with a solid ceiling
  // overhead. That is a metre-scale swim to an AIR POCKET within 8 blocks --
  // categorically not the 24-to-96-block hunt for standable ground that was
  // deleted. The two were only ever confused because both were called
  // "sideways".
  if (!losing) return { forward: false, jump: false, lookAt: null, phase: 'done' }
  return route?.dir === 'out'
    ? { forward: true, jump: true, lookAt: route.target, phase: 'to_air' }
    : { forward: false, jump: true, lookAt: null, phase: 'up' }
}

/**
 * THE ROUTE AND THE RELEASE MUST ASK THE SAME QUESTION.
 *
 * This scan had its OWN air predicate -- `name !== 'water' && boundingBox ===
 * 'empty'` -- and the rescue is released by `breathable()` in air.mjs, which is
 * a different set. Against the vendored registry for the deployed 1.21.8 the
 * two disagree about `seagrass`, `tall_seagrass`, `kelp`, `kelp_plant`,
 * `bubble_column`, every waterlogged block with an empty box, and `lava`: all
 * of them report `boundingBox: 'empty'` and none of them is named `water`, so
 * the scan called every one of them AIR and the release called every one of
 * them WATER. A rescue steered at a target it was then graded as never having
 * reached.
 *
 * MEASURED 2026-09-04, and this is the whole reason the function moved. Nine
 * bots were burning ~17% of fleet throughput in permanent drowning rescues at
 * health 20/20. Their own `_drowning_route` was read as proof that air lay two
 * blocks sideways. Read by RCON at placebo-b-Delta's exact coordinates
 * (420.7, 44.2, -306.7 in world placebo-b, confirmed against the server's own
 * `data get entity Pos`), the block this scan called air, two cells north at
 * head height, is
 *
 *     (420, 45, -309)  minecraft:seagrass
 *
 * and the server reports that bot's `Air` as 300 of 300 with `Health` 20.0f.
 * `out dist=2` was a plant. Six of the nine reported `sealed` and had no
 * sideways route at all. So the horizontal escape everyone (including me) read
 * out of that telemetry does not exist for eight of the nine.
 *
 * AND `lava` IS THE SAFETY HALF. It is `boundingBox: 'empty'` and not named
 * water, so the old predicate answered `dir: 'up'` for a bot under a lava
 * ceiling and `drowningControls` held `jump` into it -- and the sideways scan
 * would swim THROUGH a lava column looking for air beyond it. Nothing has been
 * observed doing that; it is one registry lookup away from happening and costs
 * one clause to close.
 *
 * `sealed` IS A THIRD ANSWER, NOT A SECOND NAME FOR `dir: null`. The old return
 * collapsed "every axis is closed by rock" and "the scan ran out of range still
 * in open water" into the same value, which is the tri-state-as-a-bool mistake
 * `scripts/lib/probe.py` exists to stop. A bot 33 blocks under an ocean surface
 * scans 32 cells of water, finds no air, and is NOT sealed -- holding `jump` is
 * exactly right for it. Only `sealed` may be read as "this rescue cannot help
 * here", and an unreadable (null) block anywhere on a scan clears it, because
 * an unloaded chunk is not evidence of a wall.
 *
 * @param at  (dx,dy,dz) -> block, relative to the bot's HEAD cell.
 * @returns {{dir: 'up'|'out'|null, offset: number[]|null, dist: number,
 *            sealed: boolean}}
 */
export function scanBreathableRoute ({ at = () => null, maxUp = 32, maxOut = 8,
                                       isAir = breathable } = {}) {
  // A body swims through water and air; it does not swim through lava, and it
  // does not swim through a cell nobody can read.
  const swimmable = b =>
    b != null && b.name !== 'lava' && (b.name === 'water' || b.boundingBox === 'empty')

  let unknown = false                 // any null cell: we did not SEE a wall
  let capped = false                  // up ended on something solid

  for (let dy = 1; dy <= maxUp; dy++) {
    const b = at(0, dy, 0)
    if (isAir(b)) return { dir: 'up', offset: [0, dy, 0], dist: dy, sealed: false }
    if (!swimmable(b)) { capped = true; if (b == null) unknown = true; break }
  }

  // Capped above. Look sideways along each axis for a column that opens.
  let best = { dir: null, offset: null, dist: Infinity }
  let allClosed = true
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    let closed = false
    for (let d = 1; d <= maxOut; d++) {
      const b = at(dx * d, 0, dz * d)
      if (!swimmable(b)) { closed = true; if (b == null) unknown = true; break }
      if (isAir(b) && d < best.dist) { best = { dir: 'out', offset: [dx * d, 0, dz * d], dist: d }; closed = true; break }
      // an air pocket one block up counts too -- that is the usual cave shape
      const up = at(dx * d, 1, dz * d)
      if (isAir(up) && d < best.dist) { best = { dir: 'out', offset: [dx * d, 1, dz * d], dist: d }; closed = true; break }
    }
    if (!closed) allClosed = false    // ran to maxOut still swimmable: unscanned
  }
  return { ...best, sealed: best.dir == null && capped && allClosed && !unknown }
}

export function breathableRoute(bot, { maxUp = 32, maxOut = 8 } = {}) {
  const none = { dir: null, target: null, dist: Infinity, sealed: false }
  const at = bot?.entity?.position
  if (!at || !bot.blockAt) return none
  const head = at.offset(0, 1, 0)
  const r = scanBreathableRoute({
    at: (dx, dy, dz) => bot.blockAt(head.offset(dx, dy, dz)), maxUp, maxOut,
  })
  const best = {
    dir: r.dir,
    target: r.offset ? head.offset(r.offset[0], r.offset[1], r.offset[2]) : null,
    dist: r.dist,
    sealed: r.sealed,
  }
  return best
}

/**
 * TAKE THE BODY BEFORE YOU TRY TO MOVE IT.
 *
 * mineflayer has no ownership layer over the control states: `bot.controlState`
 * is a plain object and the last writer each tick wins, silently. Worse,
 * mineflayer-pathfinder's `monitorMovement` REWRITES forward/back/jump/sprint on
 * EVERY physicsTick while a goal is set. So a reflex that simply calls
 * setControlState('jump', true) is overwritten within ~50ms and nothing logs it.
 *
 * Measured: after the drowning rescue was made reachable, instance #2 still lost
 * 8 bots to drowning in 45 minutes. The rescue was firing and being cancelled by
 * the pathfinder and by pillarOut, which writes `jump` every ~550ms of its own.
 *
 * So: clear the goal, stop any dig, drop stale inputs -- THEN steer. Order
 * matters. setGoal(null) is used rather than pathfinder.stop() because stop()
 * waits for the next node, and a drowning bot does not have a next node.
 */
function seizeBody(bot, why) {
  try { bot.pathfinder?.setGoal(null) } catch { /* plugin may be absent */ }
  try { if (bot.targetDigBlock) bot.stopDigging() } catch { /* not digging */ }
  try { bot.clearControlStates() } catch { /* not connected */ }
  return why
}

function makeThrottle(defaultMs = 10_000) {
  const last = new Map()
  return (kind, ms = defaultMs) => {
    const now = Date.now()
    if (now - (last.get(kind) ?? 0) < ms) return false
    last.set(kind, now)
    return true
  }
}

// THE RESCUE'S OWNERSHIP BUDGET.
//
// 20s was a flat ceiling: a bot two blocks from a bank and a bot alone in open
// ocean were released at exactly the same moment, and `_drowning_released_timeout`
// fired 1,075 times in twelve hours without distinguishing them. The ceiling is
// kept -- holding a body that cannot be saved starves every other reflex, and
// removing it is how the pre-ceiling deadlock came back -- but it now extends
// while the bot is DEMONSTRABLY CLOSING ON THE SAME PIECE OF SHORE, up to a hard
// cap that no amount of progress can exceed.
//
// "The same piece of shore" is the load-bearing part. Progress measured against
// whatever the scan last returned can be fabricated by re-targeting: a bot that
// picks a fresh bank every few seconds shows a falling distance forever and the
// ceiling never fires. So re-targeting resets the baseline WITHOUT refreshing
// the progress clock; only closing on a target already held counts.
// A HEAD THAT BREAKS THE SURFACE FOR ONE TICK IS NOT BREATHING.
// A bot bobbing at a wave crest clears the plane, releases, and sinks again
// still short of air -- handing the body back mid-drown, which is the shape
// behind "idle at the moment of death". The head must STAY out.
const RELEASE_DWELL_MS = 1_000
// A RESCUE THAT HAS PROVEN IT CANNOT HELP MUST STOP TAKING THE BODY.
//
// Measured 2026-09-04 over 6h on the six captured bots: 4,603
// `_drowning_ceiling_no_air` expiries, one every 28 seconds per bot, each
// reading
//
//     held 20s and never reached air (oxygen 400, health 20) -- sealed
//
// Oxygen 400 of ~400 is a FULL tank and health 20 is untouched. Those bots were
// not drowning. Zero deaths in six hours, zero health readings below 20, against
// a fleet that does record 122 sub-20 readings in the same window -- so the field
// varies and 20/20 is a reading, not a stuck value.
//
// This file already recorded the same signature once ("2,113 timeouts, at oxygen
// 399-400 out of ~400 and health 20 ... roughly 11.7 fleet-hours") and fixed the
// RELEASE. These bots never reach the release: their head is not breathable, so
// they burn the whole ceiling, expire, and are re-seized ~2s later. Nothing
// remembers that the last attempt failed.
//
// The cost is not the rescue, it is the RETURN. While the rescue owns the body
// the entombed and maroon handlers never run -- they get only the ~2s gaps, and
// this file already documents that exact shape as a bug for the suffocation
// branch: "it could never reach the one routine that would free it ... So: fall
// through. Do not return."
//
// KEYED ON OUTCOME, NOT ON CAUSE. Whatever makes the evidence guard flicker --
// and `bot.oxygenLevel` is written from any nearby entity's air_supply, which is
// confirmed and unfixed -- a rescue that held the full ceiling and produced no
// air, at a position the bot has not left, with no health lost, has demonstrated
// it cannot help there. A bot that is genuinely drowning LOSES HEALTH, and that
// clears the suppression immediately. So this cannot hold back a real rescue.
const DROWN_FAIL_SUPPRESS = 2          // failed ceilings at one spot before yielding
const DROWN_MOVED_BLOCKS = 1.5         // moving this far means it is a new situation

/**
 * Should the drowning rescue decline to seize the body right now?
 *
 * THE MOVEMENT CLAUSE HAD ONE READER IT DID NOT EXPECT: THE ESCAPE ITSELF.
 *
 * "Moved 1.5 blocks, so it is a new situation" is right for a bot that swam
 * somewhere. It is wrong for the only thing this suppression exists to let
 * happen. `escapeStairUp` cuts a 1:1 ramp, so ONE step moves the bot 1.41
 * blocks and TWO move it 2.83 -- past the threshold, on the escape's own
 * progress. The rescue then re-arms, `seizeBody()` calls `bot.stopDigging()`
 * mid-swing, and a bare-handed stone dig is 7.5 seconds long. That is not
 * speculation about a future deploy; it is the second-commonest thing in the
 * live telemetry today, quoted verbatim from `_entombed_ramp_cut`:
 *
 *     stopped because yielded the body to the drowning rescue
 *     stopped because ceiling dig failed on stone: Digging aborted
 *
 * Measured 2026-09-04, 3h, live: those two strings are every ramp failure on
 * five of the nine trapped bots. The ramp is already correct, already
 * material-free, and is being cut off by this rescue in two different ways.
 *
 * So the clearing rule is asked to match the evidence it stands on. The
 * evidence was "a full ceiling was held HERE and produced no air"; a metre of
 * ramp inside the same sealed pocket does not disturb it. What does disturb it
 * is air becoming reachable -- which is the moment the rescue becomes useful
 * again, and is exactly when `sealedHere` goes false.
 *
 * WHY THIS CANNOT HIDE A DROWNING, which is the only part that matters:
 *   - `healthDropped` still outranks everything, unchanged and first.
 *   - `sealed` means every axis is closed by a block we READ. The rescue's only
 *     primitives are lookAt/forward/jump; with no route there is nothing for it
 *     to steer at, so what is being withheld is a rescue that provably cannot
 *     act. An unreadable cell, or a scan that merely ran out of range in open
 *     water, is NOT sealed -- see `scanBreathableRoute`.
 *   - It defaults to `false`, so every caller that does not pass it keeps
 *     today's behaviour exactly, and a route object without the field fails
 *     open toward rescuing.
 *
 * @param failures      consecutive expired rescues at ~this position
 * @param movedBlocks   distance from where the last one failed
 * @param healthDropped has the bot lost health since that failure?
 * @param sealedHere    is air still unreachable on every axis we can read?
 * @returns true = do not seize; fall through to the escape handlers
 */
export function drownRescueSuppressed ({ failures = 0, movedBlocks = 0,
                                         healthDropped = false,
                                         sealedHere = false } = {}) {
  if (healthDropped) return false                 // real harm always outranks this
  // FAIL OPEN, TOWARD RESCUING. An unreadable position is not evidence that the
  // bot stayed put, and reading it that way would let a bookkeeping failure
  // switch off the air reflex -- the one reflex the owner directive keeps.
  // Caught by test: `{failures: 2, movedBlocks: NaN}` suppressed before this.
  if (!Number.isFinite(movedBlocks)) return false
  if (!Number.isFinite(failures)) return false
  // Moving away clears it -- UNLESS the bot is still sealed in, in which case
  // the move it made is the escape working and the situation is unchanged.
  // `=== true` and not a truthy test: a missing field must read as "not sealed".
  if (movedBlocks >= DROWN_MOVED_BLOCKS && sealedHere !== true) return false
  return failures >= DROWN_FAIL_SUPPRESS
}

const RESCUE_CEILING_MS = 20_000
const RESCUE_CEILING_MAX_MS = 45_000
const PROGRESS_STALL_MS = 5_000

export function startReflexes(bot, runner, lessons = null, worldFacts = null) {
  // Publish a hazard to the fleet, but only once this bot has hit it enough
  // times to be sure. One bad reading must not become everyone's belief --
  // tonight a broken oxygen check wrote 466 "drowning" events for a place with
  // no water in it, and under sharing that would have been fleet doctrine.
  const shareHazard = (kind, pos) => {
    const mine = lessons?.recordHazard(kind, pos) ?? 0
    if (worldFacts && pos && mine >= 2) {
      const fresh = worldFacts.reportHazard(kind, pos, mine)
      if (fresh) announceHazard(bot, kind, pos, mine)
    }
  }

  const throttled = makeThrottle()
  let lastPos = null
  let stillSince = Date.now()
  let eating = false
  let lowHealthLatched = false
  let lowOxygenLatched = false
  // The maroon check runs a real pathfinder search, so it is rate-limited rather
  // than run on every tick, and re-entrancy is blocked while the climb is in
  // progress -- a rescue that keeps re-triggering itself never finishes.
  let marooned = false
  let lastMaroonCheck = 0
  // Reported once per bot lifetime, not latched-and-cleared: a bad reading is a
  // defect to notice, not an event to count, and the last thing this needs is a
  // second signal that fires hundreds of times.
  let badOxygenReported = false
  // A RESCUE IN PROGRESS, so the tick stops cancelling its own swim.
  //
  // The old branch called seizeBody() -- which clears every control state -- on
  // EVERY tick, then armed a 1200ms timeout to clear them again. At a 500ms tick
  // that is three overlapping timeouts in flight at once, each wiping controls
  // that a later tick had just set. The bot got a fraction of a stroke at a time
  // and treaded water until it died.
  //
  // Measured: after the flooded-cave fix shipped, drowning deaths did not move
  // at all -- 8 per fleet in twenty minutes, unchanged. The route was almost
  // always found (drowning_sealed fired ONCE across both fleets), so the bot
  // knew where air was and could not swim there. Seize once, steer every tick,
  // release when it can breathe.
  let rescuing = false
  // WHO OUTRANKS THE ESCAPE RAMP. Passed to `escapeStairUp`, which holds the
  // body for up to a minute and clears the controls at every step boundary --
  // in the same tick loop the drowning branch below steers from. Without this
  // the ramp wipes a stroke a drowning bot is depending on. It yields rather
  // than claiming because standing the water rescue down is the change that
  // multiplied drownings 7.5x (canary 4a1dfcb, p = 0.0079), and because a ramp
  // resumes from the step it stopped on while a drowning bot does not.
  const drowningOwnsBody = () => (rescuing ? 'the drowning rescue' : null)
  let seizedAt = 0
  let headOutSince = 0
  // Per-rescue progress, reset at seizure. See RESCUE_CEILING_MS above.
  let bestHomeDist = Infinity      // closest approach to home while crossing
  let lastProgressAt = 0
  // Consequence of the PREVIOUS release, so a release can be graded by what
  // happened next rather than by what it claimed at the time.

  // Surface-hold episodes. Entry alone cannot say whether holding WORKED -- a
  // high count is ambiguous between "prevention is working" and "bots keep
  // ending up in bad states" -- so duration and aftermath are recorded too.
  let holdStartedAt = 0
  let holdMinOxygen = Infinity
  // Start values, so the hold can be graded on whether it CHANGED anything.
  let holdStartOxygen = null
  let holdStartHealth = null
  // Was the head ever underwater during this episode? A "hold" that spent any
  // of its life submerged is not the same event as one that floated, and
  // averaging them together is what hid the 32%.
  let holdStartHeadInAir = false
  let holdHeadEverSubmerged = false
  let holdStartState = null
  // Air the local wildlife cannot edit. See air.mjs.
  const airClock = makeAirClock()
  let lastAirDist = Infinity
  let lastReleaseAt = 0
  let lastReleaseKind = null
  // A GATE MUST NOT MEASURE ITS OWN TRIGGER.
  //
  // The critical-oxygen override added in b6a4845 fires below 25% air, and the
  // obvious safety metric -- "how often was air critical" -- would then be
  // counting MY OWN MECHANISM rather than the world. Improving the override
  // would move the number whether or not any bot was safer, which is precisely
  // the escape-rate mistake wearing a different hat.
  //
  // So the physical state is detected here, independently of whether the
  // override acted on it, and latched so it records ENTRY into danger rather
  // than every tick spent there.
  let oxCriticalLatched = false

  // Logged only on change: the phase is re-evaluated twice a second.
  let lastDrownPhase = null
  // ASHORE, NOT JUST BREATHING. Releasing the body at first breath left the
  // bot bobbing mid-lake: cognition resumed, re-proposed the same crossing,
  // and the reflex fired again -- 300+ drowning_route firings per bot-hour of
  // exactly this loop in Block 1. The rescue is finished when the bot is
  // STANDING ON GROUND THAT IS NOT WATER, not when its lungs refill; the held
  // control states keep the last stroke (toward land) running in between.
  // The 20s deadline is the owner's own explicit release for the sealed-cave
  // case where no shore exists -- not a timeout clearing someone else's
  // controls.
  const ashore = () => {
    if (!bot.entity?.onGround) return false
    const below = bot.blockAt?.(bot.entity.position.offset(0, -1, 0))
    return !!below && below.name !== 'water' && below.name !== 'bubble_column' &&
           !below.name.includes('kelp') && !below.name.includes('seagrass')
  }
  // shoreScan() was here: a Chebyshev sweep out to radius 24-96, up to 6,000
  // block reads, twice a second, per bot, to answer "where is the nearest
  // place I could stand". Deleted. `shoreRoute` itself still exists in
  // shore.mjs for admission, which asks a question shore actually answers.

  // ONE deadline, asked in both places. Phase-2 steering and the release branch
  // used to test `seizedAt` against 20s independently; extending only one of
  // them yields a bot that stops swimming at 20s but stays owned until 45s --
  // strictly worse than the flat ceiling it replaced.
  // TRAVELLING IS NOT RESCUING, AND IT MUST NOT BE ON A CLOCK.
  //
  // A bot at the surface of the ocean is not in danger. Air only drains while
  // the head is submerged and refills the moment it is not, so surface
  // swimming has no time limit in this game at all -- the only real cost is
  // exhaustion, which drains hunger slowly. A bot with food can swim across
  // the world.
  //
  // The ceiling was written for a RESCUE: hold the body briefly, get the bot
  // out, give it back. Applied to a crossing it is absurd. Measured: bots in
  // the no-shore state are a median 1,244 blocks from home, p90 1,513. At
  // surface speed that is 565 seconds. RESCUE_CEILING_MAX_MS is 45.
  //
  // So the previous change -- swim toward home instead of treading water --
  // bought 8% of the journey and then released an unowned body into open
  // water exactly as before. Fixing the bearing while leaving the clock is
  // not a fix.
  //
  // Ownership here is earned by PROGRESS, not granted by a stopwatch. While
  // the bot is genuinely closing on a named target the ceiling does not
  // apply; the stall check still does, and air, health and a waiting skill
  // all still preempt above this.
  let travelling = false
  // Where the last ceiling expired, so a rescue that failed here is not retried
  // here. Cleared by movement or by real harm -- see drownRescueSuppressed.
  let drownFails = 0
  let drownFailPos = null
  let drownFailHealth = null
  const rescueExpired = () => {
    const held = Date.now() - seizedAt
    if (held <= RESCUE_CEILING_MS) return false
    const stalled = Date.now() - lastProgressAt >= PROGRESS_STALL_MS
    if (travelling) return stalled
    if (held >= RESCUE_CEILING_MAX_MS) return true
    return stalled
  }

  // Largest air value this bot has reported. It sits at full whenever the bot is
  // on land, so this converges within seconds of spawning and tells assessAir
  // which scale the server is actually using. See the note above assessAir.
  let airMax = 20
  let prevHealth = null
  const airSamples = []
  let escaping = false
  // Per-bot, not module-level: two bots entombed at once must not share a
  // cooldown or a failure count.
  let lastEscapeAt = 0
  let lastMaroonPrereqAt = 0
  let escapeFailures = 0
  // Cumulative, NOT reset by a give-up. The give-up branch used to zero
  // escapeFailures and return, so a bot that could never escape ran
  // four-attempt cycles forever at a constant rate while its log claimed the
  // watchdog had taken over. Solo02 did exactly that at y=-16, and the
  // watchdog has no entombed handler at all.
  let escapeGiveUps = 0
  let climbRefusals = 0        // pillar declined to START -- see the refusal branch
  let refusalPlaceStreak = 0   // ...how many of those in a row were from HERE
  let lastRefusalPos = null    // ...and WHERE, so the streak means one hole
  let reflexErrors = 0

  const timer = setInterval(async () => {
    if (!bot.entity) return

    try {
      // --- survey: remember where the good things are ----------------------
      // The fleet's memory was entirely negative -- hazard sites and failed
      // actions, both with coordinates, and nothing about where anything useful
      // is. A bot could walk past a forest, die, and have learned nothing.
      //
      // Deliberately cheap and throttled: a handful of block types, radius 40,
      // one hit each. `gather` at radius 96 is what nearly killed the host four
      // times tonight, so this stays small on purpose -- it is a sighting log,
      // not a search.
      if (worldFacts && throttled('survey', 20000)) {
        for (const name of SURVEY_BLOCKS) {
          const t = bot.registry?.blocksByName?.[name]
          if (!t) continue
          const hit = bot.findBlocks({ matching: t.id, maxDistance: 40, count: 1 })[0]
          if (hit) worldFacts.reportResource(name, hit)
        }
      }

      // --- low oxygen -----------------------------------------------------
      // LATCHED, for the same reason the health check below is latched: this
      // ran level-triggered and fired on every tick while oxygen was low.
      // Measured live -- 145-226 events per bot per ten minutes, ~200x the
      // real rate, drowning out genuine telemetry and re-interrupting the
      // skill runner continuously so the bot could never act its way out.
      //
      // Losing air does NOT mean drowning. A head inside a solid block
      // suffocates identically, and the two need opposite responses: jumping
      // surfaces a swimmer and does nothing for someone entombed. Observed
      // live -- four bots emitting "drowning" with no water anywhere near
      // them, one with its head inside a grass_block.
      const head = bot.blockAt(bot.entity.position.offset(0, 1, 0))
      const inWater = head?.name === 'water' || bot.entity.isInWater === true
      // Advanced on EVERY tick, not only while rescuing: a bot released ashore
      // and re-seized seconds later must not inherit dry time it did not earn.
      // THE COUNTER IS NOT THE CONDITION.
      //
      // Suffocation needs a head inside a solid block; drowning needs a head in
      // water. If neither is true the bot is standing in open air and is not
      // losing air, whatever oxygenLevel reports -- and acting on the counter
      // alone calls runner.interrupt() on a bot that has nothing to escape from.
      //
      // Measured on instance #2: Miner01 sat at 42,22,-180 for SEVENTY MINUTES
      // at 20/20 health with air at head height, emitting `suffocating
      // oxygen=0 head=air` every few seconds. Each one interrupted the running
      // skill, so no goto, no unstick and no relocation could ever run to
      // completion. The watchdog, the livelock breaker and the entombed handler
      // all fired correctly and were all cut off mid-stride by this.
      //
      // The oxygen field oscillated 0 -> 12+ -> 0 between ticks, which also
      // re-armed the latch each time, so the latch could not damp it either.
      // A latch cannot fix a signal that is wrong; it only slows it down.
      const headSolid = head != null && head.boundingBox === 'block'
      // HEALTH IS THE ARBITER, because it is the one value the SERVER owns.
      //
      // My first version of this guard trusted the block lookup: head is air, so
      // the oxygen counter must be wrong, so do not act. That was right for the
      // case it was written for -- oxygen=0 at 20/20 health with nothing
      // happening -- and wrong the moment mineflayer's chunk view disagreed with
      // the server about water. Measured immediately after deploying it: 2
      // "reading not actionable" events and 2 drowning deaths in four minutes,
      // one for one. The bots were drowning and this was explaining it away.
      //
      // A bot losing health while its air is gone is drowning, whatever
      // blockAt() thinks it is standing in. Acting costs a jump; not acting
      // costs the bot.
      // The policy now lives in assessAir(), a pure function of bot state, so it
      // can be asserted without a server. This block is only the plumbing:
      // logging, telemetry, and the control inputs.
      // AIRMAX MUST BE ABLE TO COME BACK DOWN.
      //
      // This only ever ratcheted UP, so a single anomalous reading -- one
      // tick-scale value on a build that otherwise reports bubbles -- pinned
      // airMax at 300 for the life of the process. The trigger is 40% of it, so
      // the threshold became 120 while every real reading was <= 20, and the
      // bot believed it was suffocating permanently.
      //
      // Track the max over a recent window instead. Self-calibration was the
      // right idea; making it irreversible was the bug.
      if (bot.oxygenLevel != null) {
        airSamples.push(bot.oxygenLevel)
        if (airSamples.length > 240) airSamples.shift()   // ~2 min at 500ms
        airMax = Math.max(20, ...airSamples)
      }
      // The PEAK of the recent window, not the immediately previous tick -- one
      // sample is noise, and what matters is whether the counter has fallen
      // away from where it has been sitting.
      const recent = airSamples.slice(-12)
      const prevOxygen = recent.length ? Math.max(...recent) : null
      const air = assessAir(bot, { airMax, prevOxygen })
      // RELEASE THE BODY the moment breathing resumes, and say so. Without this
      // the bot would hold `jump` forever after surfacing, and -- more useful --
      // there was no positive signal anywhere: deaths were counted and rescues
      // were not, so a rescue that worked and a rescue that did nothing looked
      // identical in telemetry. Escapes are now countable against drownings.
      //
      // "NOT LOSING" IS NOT "SAFE", AND THE DIFFERENCE KILLED Miner01.
      //
      // assessAir reports losing=false in two OPPOSITE situations, because both
      // are flat: oxygen pinned at FULL (wading -- the case the trend test above
      // was written for) and oxygen pinned at the FLOOR, where a drowning bot's
      // counter has nothing left to drain. The trend cannot tell them apart.
      //
      // On 2026-08-10 Miner01 logged fourteen consecutive `drowning_escaped
      // success` at -24,60,-90 while oxygen fell 283 -> 262 -> 256 -> 18 -> 15,
      // never moved a block, and then drowned. Every one of those releases
      // handed the body back to a skill that walked it straight under again.
      // The death cost the entire inventory (-236 items) and every milestone
      // behind it: the bot spent the next several minutes failing to craft a
      // wooden_pickaxe it no longer had the logs for.
      //
      // So require POSITIVE evidence of breathing -- back above the threshold
      // that triggers a rescue, or measurably rising -- instead of inferring
      // safety from the absence of a decline. A bot still at the floor keeps
      // its rescue, which is the entire point of having one.
      // PHASE 2 CANNOT LIVE INSIDE THE DROWNING BRANCH.
      //
      // assessAir() reports act:'swim' only while the bot is LOSING air -- every
      // other path returns act:'none' -- so the moment oxygen recovers, the
      // swim branch below stops running entirely. The first version of this fix
      // put the swim-to-shore steering there and it never executed once: 34
      // `drowning_up` events and ZERO `drowning_to_shore` in eight minutes of
      // live fleet. The bot surfaced, the branch went quiet, and the held
      // controls (forward=false, jump=true) kept it floating exactly as before.
      //
      // So the breathing-but-not-ashore phase runs here, on its own terms: it
      // is a rescue we still own, not a drowning we are still fighting.
      // THE PHYSICAL STATE, recorded whether or not anything acted on it.
      const oxNow = bot.oxygenLevel
      {
        const frac = airMax > 0 ? (oxNow ?? 0) / airMax : 0
        const transition = airCriticalTransition(oxNow, airMax, oxCriticalLatched)
        if (transition === 'enter') {
          oxCriticalLatched = true
          logEvent({
            kind: 'oxygen_critical_state', status: 'failed',
            detail: `air fell to ${Math.round(frac * 100)}% (${oxNow}/${airMax}); ` +
                    `rescuing=${rescuing} swimming=${!!bot.waterTravel?.active} ` +
                    `health ${bot.health}`,
            snapshot: snapshot(bot),
          })
        } else if (transition === 'clear') {
          oxCriticalLatched = false
        }
      }

      // THE SURFACE-HOLD IS BACK, AND THE ABLATION IS WHY.
      //
      // It was removed in e051cd5 because three attempts to write an efficacy
      // criterion for it all classified the hold HANDING OFF to a rescue as the
      // hold failing. Rather than write a fourth, the mechanism was removed and
      // the same G1/G2 gates re-run without it.
      //
      // Drowning deaths per EXPOSURE-WEIGHTED bot-hour:
      //     baseline (never had it)   0.0820
      //     hold ON                   0.0361
      //     hold OFF (the ablation)   0.1263
      //
      // 4 drowning deaths in 32 exposure-weighted bot-hours. Under the hold-ON
      // rate that outcome has probability 0.030 -- the data REJECTS "the hold
      // made no difference". It was load-bearing, and removing it returned
      // drowning deaths to at or above the pre-water-work baseline.
      //
      // The ablation answered in 32 bot-hours what three criteria could not.
      // When a mechanism resists specification, remove it and measure.
      // NOBODY MAY OWN NOTHING WHILE A BOT IS IN WATER.
      //
      // Releasing a stranded bot instead of pinning it was meant to give it its
      // body back. What it actually did was hand the body to NO ONE: the release
      // clears every control state, and if the cognitive loop has no action
      // pending, the bot sinks. Of 23 drowning deaths, 15 have `_reflex_low_health`
      // as their last event followed by roughly 24 seconds of total silence.
      // They were not fighting to get out. They were idle, underwater.
      //
      // The old pinning behaviour was wasteful -- 20 seconds of paralysis per
      // cycle -- and I mistook that cost for its whole effect. Holding `jump` was
      // also LIFE SUPPORT, and removing it removed the only thing keeping an
      // unowned bot's head above water.
      //
      // This restores the life support without restoring the paralysis. It is
      // not a rescue and it does not seize the body: it asserts one control, on
      // a bot nobody else is steering, and only while that bot is in water and
      // not ashore. Any skill or rescue that wants the body still takes it.
      const feetBlock = bot.blockAt?.(bot.entity.position)
      const headBlock = bot.blockAt?.(bot.entity.position.offset(0, 1, 0))
      let airRoute = null
      const holdState = waterPosture({
        owned: rescuing || !!bot.waterTravel?.active,
        ashore: ashore(),
        feet: feetBlock,
        head: headBlock,
        route: () => (airRoute = breathableRoute(bot)),
      })
      if (holdState) {
        // JUMP IS NEVER THE WHOLE ACTION WHEN THE HEAD IS UNDER.
        //
        // Treading water is jump without a direction; swimming is jump WITH
        // one. `float` is the single case where up is the only thing wanted,
        // because the head is already out and the bot is simply staying there.
        bot.setControlState('jump', true)
        if (holdState === 'surface_out' && airRoute?.target) {
          bot.setControlState('forward', true)
          try { bot.lookAt(airRoute.target, true) } catch { /* not connected */ }
        } else if (holdState !== 'float') {
          // Rising: up IS the direction. Do not also drive it sideways into a
          // wall it cannot see.
          bot.setControlState('forward', false)
        }
        if (!holdStartedAt) {
          holdStartedAt = Date.now()
          holdMinOxygen = bot.oxygenLevel ?? Infinity
          holdStartOxygen = bot.oxygenLevel ?? null
          holdStartHealth = bot.health ?? null
          holdStartState = holdState
          holdStartHeadInAir = holdState === 'float'
          holdHeadEverSubmerged = holdState !== 'float'
          // Only a real surface hold is logged as one. `surface_first` and
          // `blocked_surface` used to be counted here, which is how a third of
          // "holds" came to end with less air than they started.
          logEvent({ kind: `water_${holdState}`,
                     status: 'success',
                     detail: `afloat and unowned — ${holdState} ` +
                             `(head ${headBlock?.name ?? '?'}, health ${bot.health})`,
                     snapshot: snapshot(bot) })
        }
        if (holdState !== 'float') holdHeadEverSubmerged = true
        if (typeof bot.oxygenLevel === 'number') {
          holdMinOxygen = Math.min(holdMinOxygen, bot.oxygenLevel)
        }
      } else if (holdStartedAt) {
        // THE AFTERMATH IS THE MEASUREMENT. Entry count alone cannot tell
        // "prevention is working" from "bots keep ending up in bad states", and
        // a hold that ends because the bot drowned is not a hold that worked.
        const heldMs = Date.now() - holdStartedAt
        const lowest = holdMinOxygen === Infinity ? null : holdMinOxygen
        const dipped = lowest != null && airMax > 0 && lowest / airMax <= 0.25
        // THE DELTAS ARE THE GRADE. Air falling across the hold means the hold
        // did not arrest the decline; health falling means it did not protect.
        const dAir = (holdStartOxygen != null && bot.oxygenLevel != null)
          ? bot.oxygenLevel - holdStartOxygen : null
        const dHealth = (holdStartHealth != null && bot.health != null)
          ? bot.health - holdStartHealth : null
        // THE GRADE IS THE HEAD AND THE HEALTH, NOT A DIP THRESHOLD.
        // `dipped` asks whether air fell below a quarter, which a bot that was
        // ALREADY submerged when the hold began fails through no fault of the
        // hold. What the hold owes is: the head stayed breathable, and nothing
        // got hurt. Anything else is a failure regardless of the air trace.
        const headEndInAir = (() => {
          const h = bot.blockAt?.(bot.entity.position.offset(0, 1, 0))
          return breathable(h)
        })()
        // GRADE THE INTERVENTION, NOT THE SITUATION IT INHERITED.
        // `holdStartHeadInAir` is an ENTRY condition. Folding it into the grade
        // marks a hold that found a submerged bot and got its head up as a
        // FAILURE, and a run of them would read as the reflex getting worse
        // exactly when it was working hardest. The entry condition is reported
        // instead, so the two populations can be split downstream.
        const startedSubmerged = !holdStartHeadInAir
        const wentUnder = holdHeadEverSubmerged
        const startedAs = holdStartState ?? 'hold_surface'
        holdStartState = null
        holdStartedAt = 0
        holdMinOxygen = Infinity
        holdStartOxygen = null
        holdStartHealth = null
        holdStartHeadInAir = false
        holdHeadEverSubmerged = false
        logEvent({
          // ONE KIND PER START STATE. A single `..._ended` kind puts floats
          // and submerged recoveries in one bucket, which is the ambiguity this
          // change exists to remove -- and no count-based query would see it.
          // The old `water_surface_hold*` series is deliberately NOT reused:
          // it graded episodes by an air dip and by a predicate that counted
          // kelp as water, so continuing it would splice two definitions into
          // one line. New names, new series, honest break.
          kind: `water_${startedAs}_ended`,
          status: (headEndInAir && (dHealth ?? 0) >= 0) ? 'success' : 'failed',
          detail: `held ${(heldMs / 1000).toFixed(1)}s; ` +
                  `head ${startedSubmerged ? 'started SUBMERGED' : 'started in air'}` +
                  `${headEndInAir ? ', ended in air' : ', ended SUBMERGED'}` +
                  `${wentUnder && !startedSubmerged ? ', went under mid-hold' : ''}; ` +
                  `dAir ${dAir ?? '?'}; ` +
                  `dHealth ${dHealth ?? '?'}; lowest air ` +
                  `${lowest ?? '?'}/${airMax}${dipped ? ' — DIPPED CRITICAL while held' : ''}; ` +
                  `ended because ${ashore() ? 'ashore' : rescuing ? 'a rescue took over'
                    : bot.waterTravel?.active ? 'a swim took over' : 'no longer in water'}` +
                  ` (health ${bot.health})`,
          snapshot: snapshot(bot),
        })
      }

      // A DELIBERATE CROSSING IS NOT AN EMERGENCY.
      //
      // `bot.waterTravel` is set by the swim_to skill for exactly as long as a
      // crossing is in progress. While it is set, being wet is the plan, and a
      // rescue that seizes the body is not saving the bot -- it is cancelling
      // its journey. Measured 2026-08-22: bots swam 50-70 blocks between
      // consecutive `drowning_no_shore` events while this branch held them at
      // `forward:false`, and `drowning_reentry` fired 74 times against 108
      // releases. That counter was measuring a livelock, not a rescue.
      //
      // What does NOT change: `air.losing` still outranks everything below. A
      // swimmer whose oxygen is actually draining gets seized, because that is
      // the case this reflex was written for after eight bots drowned in
      // forty-five minutes.
      const swimming = !!bot.waterTravel?.active

      // PHASE 2 IS GONE. It ran here: breathing, not ashore, therefore swim to
      // a bank. It was the single largest source of wasted ownership in the
      // project and it chased a goal no bot ever had.
      //
      // THE RESCUE ENDS WHEN THE BOT IS BREATHING. NOT WHEN IT IS DRY.
      //
      // `ashore()` used to be the only non-timeout way out of a rescue, and
      // that one line is the whole defect in miniature: it made LAND the
      // release condition for an emergency that was only ever about AIR. A bot
      // with full lungs treading open water was pinned at `forward:false,
      // jump:true` for the entire ceiling because it had nowhere to stand, then
      // handed back to a cognitive loop that would not act for another thirty
      // seconds -- in water. That is why 58 of 61 drowning deaths read "idle at
      // the moment of death".
      //
      // Deleting `ashore()` WITHOUT putting `breathingAgain` in its place would
      // have been worse than either version: `rescuing` would stay latched
      // until `rescueExpired()` and every rescue would become a 45-second
      // ownership hold. The two changes are one change.
      //
      // `rescueExpired()` stays as a backstop for the sealed case -- a bot with
      // no route up and none sideways is not breathing and would otherwise be
      // held forever -- but it is no longer how a normal rescue ends.
      // BREATHING IS A GEOMETRIC FACT, NOT A SENSOR READING.
      //
      // This used to ask `breathingAgain(bot.oxygenLevel, ...)`. mineflayer
      // writes bot.oxygenLevel from ANY nearby entity's air_supply -- a fish
      // swimming past sets a drowning bot's oxygen to full. That is confirmed,
      // three attempted fixes failed, and the field is not trustworthy. Making
      // it the release condition for the rescue would have handed the body back
      // to whatever swam past.
      //
      // The head block is read directly and cannot be spoofed by wildlife. The
      // oxygen heuristic survives only for the case where the block cannot be
      // read at all, where geometry has nothing to say.
      const headOut = breathable(head)
      headOutSince = headOut ? (headOutSince || Date.now()) : 0
      const breathing = headOut
        ? Date.now() - headOutSince >= RELEASE_DWELL_MS
        : (head == null && breathingAgain(bot.oxygenLevel, recent, airMax))
      if (rescuing && !air.losing && breathing) {
        const rel = swimming
          ? { kind: 'drowning_yielded_to_swim', status: 'success', escaped: false, landed: false }
          : drowningRelease()
        rescuing = false
        lastReleaseAt = Date.now()
        lastReleaseKind = rel.kind
        lastDrownPhase = null
        try { bot.clearControlStates() } catch { /* not connected */ }
        logEvent({
          kind: rel.kind,
          status: rel.status,
          detail: rel.kind === 'drowning_yielded_to_swim'
            ? `a swim_to crossing is in progress \u2014 handing the body back ` +
              `(oxygen ${bot.oxygenLevel}, health ${bot.health})`
            : `breathing after ${Math.round((Date.now() - seizedAt) / 1000)}s ` +
              `(oxygen ${bot.oxygenLevel}, health ${bot.health}); ` +
              `still in water: ${inWater ? 'yes' : 'no'} \u2014 which is terrain, not a failure`,
          snapshot: snapshot(bot),
        })
      }
      // A rescue that ran the ceiling without ever restoring breath is the
      // sealed case, and it is a real failure -- logged separately so it can
      // never hide inside the success kind again.
      if (rescuing && rescueExpired()) {
        rescuing = false
        // REMEMBER THAT IT FAILED. Nothing did, which is why the same rescue ran
        // 4,603 times in six hours on six bots at full oxygen and full health.
        const hereNow = bot.entity?.position
        const movedFromFail = (drownFailPos && hereNow)
          ? drownFailPos.distanceTo(hereNow) : Infinity
        drownFails = movedFromFail >= DROWN_MOVED_BLOCKS ? 1 : drownFails + 1
        // KEEP THE LAST KNOWN POSITION. This wrote `null` when the position was
        // unreadable on that tick, and `movedSinceFail` then computes Infinity
        // forever after -- which the predicate's fail-open guard turns into
        // "never suppress", permanently, for that bot. One unreadable tick
        // disabled the whole mechanism. Observed live: placebo-b-Delta yielded
        // and the rescue re-seized 7s later, every 32-37s, unbroken.
        //
        // A stale reference position is strictly better than none: the bot has
        // not moved (that is the condition being measured), and if it HAS moved
        // the distance check clears it on the next tick anyway.
        if (hereNow) drownFailPos = hereNow.clone()
        drownFailHealth = bot.health ?? null
        lastReleaseAt = Date.now()
        lastReleaseKind = 'drowning_ceiling_no_air'
        lastDrownPhase = null
        try { bot.clearControlStates() } catch { /* not connected */ }
        logEvent({
          kind: 'drowning_ceiling_no_air',
          status: 'failed',
          detail: `held ${Math.round((Date.now() - seizedAt) / 1000)}s and never reached air ` +
                  `(oxygen ${bot.oxygenLevel}, health ${bot.health}) \u2014 sealed, no route up or out`,
          snapshot: snapshot(bot),
        })
      }
      // Detection is allowed to be noisy; the BODY is not.
      const mayAct = airConsequenceEvidence(bot, air, {
        oxygenSamples: airSamples.slice(-6),
        previousHealth: prevHealth,
        // The server's actual scale, not the default: assessAir learns this at
        // runtime because 1.21.8 reports ~400 where the constant assumes 20, and
        // a critical threshold computed against the wrong scale never fires.
        airMax,
        // The world's opinion, so a stale oxygen number cannot seize a bot that
        // is standing in dry air. See the floor-case note in the function.
        head,
      })
      prevHealth = bot.health ?? prevHealth

      if (air.losing) {
        if (throttled('oxygen', 8000) && !lowOxygenLatched) {
          lowOxygenLatched = true
          log('warn', `reflex: ${air.kind}`, {
            oxygen: bot.oxygenLevel, head: head?.name, health: bot.health,
          })
          shareHazard(air.kind, bot.entity?.position)
          logEvent({
            // A distinct kind when we are only OBSERVING, so the two can be
            // told apart in telemetry instead of inflating the same counter.
            kind: mayAct ? `reflex_${air.kind}` : `air_${air.kind}_observed`,
            detail: `oxygen ${bot.oxygenLevel}, head block ${head?.name ?? 'unknown'}, health ${bot.health}`,
            snapshot: snapshot(bot),
          })
          if (mayAct) runner.interrupt(air.kind)
        }
        // THE REFLEX MAY NOT CANCEL A JOURNEY.
        //
        // Water is terrain and swimming is a mode of travel. mineflayer-
        // pathfinder ALREADY swims: while a goal is set it aims at the next
        // node, holds `forward`, and holds `jump` whenever `isInWater`
        // (index.js:607-613) -- jump WITH a direction, which is exactly the
        // stroke this reflex kept replacing with a shore dash. `seizeBody()`
        // calls `setGoal(null)`, so every seizure on a wet bot DELETED a
        // working swim. Measured: wet travel was `interrupted` in 28% of calls
        // against 7% dry, `swim_to` succeeded 4% of the time, and 231 crossings
        // produced 11 arrivals.
        //
        // So being wet, being submerged, and even having little air are no
        // longer sufficient. The gate is `airEmergency`: head actually under,
        // the derived clock nearly out, and nothing already fixing it. A bot
        // closing on air is left alone -- it is solving the problem, and taking
        // the body destroys the solution.
        const airSeconds = airClock.update(bot, Date.now())
        const route = breathableRoute(bot)
        const airDist = route?.dist ?? Infinity
        const closingOnAir = airDist < lastAirDist - 0.01
        lastAirDist = airDist
        const emergency = airEmergency({
          headUnder: !breathable(head),
          airSeconds,
          closingOnAir,
          healthFalling: prevHealth != null && (bot.health ?? prevHealth) < prevHealth,
        })
        // WHO IS DRIVING DECIDES WHETHER THIS STANDS DOWN.
        //
        // The first version gated EVERY seizure on `airEmergency`, including
        // for a bot nobody was steering. Canary 4a1dfcb, pool placebo-c, 70
        // minutes: swim success rose 6.7% -> 16.3% and reentry-per-escape fell
        // 8.56 -> 3.25, and it drowned bots at 0.526/bot-h against 0.070 for
        // concurrent controls -- 7.5x, p = 0.0079. Rolled back.
        //
        // The event mix says exactly why: 193 `_water_float` + 156
        // `_water_surface` (nobody steering) against 17
        // `_water_travel_uninterrupted` (someone steering). Bots spend almost
        // all their water time UNOWNED, and the rescue was the only thing
        // coming for them. All three drownings were `idle at the moment of
        // death`.
        //
        // So: a bot with a goal is crossing on purpose and is left alone unless
        // it is genuinely out of air. A bot with NO goal gets the full rescue,
        // exactly as before. Water is still terrain; nobody is being pulled out
        // of it for being wet. This only decides who is already responsible.
        // A LEFTOVER GOAL IS NOT AN OWNER.
        //
        // This was `!!bot.pathfinder?.goal` alone, and pathfinder goals outlive
        // the skill that set them: a bot whose skill ended without clearing the
        // goal reads as "travelling" while nothing is steering it. The rescue
        // was then gated on airEmergency and never fired.
        //
        // Measured over 5.6 hours fleet-wide: drownings rose to 0.76 per 1,000
        // water events against a pre-deploy 0.26-0.33, and STILL RISING -- and
        // 42 of 45 of them were `idle at the moment of death`, only 3 mid-skill.
        // The gate was never cancelling real crossings; it was declining to
        // rescue bots that had merely forgotten to put their goal down.
        //
        // Ownership means a skill is RUNNING. Both conditions, so a stale goal
        // cannot exempt a body nobody is driving.
        const owned = runner?.isBusy?.() === true && !!bot.pathfinder?.goal
        if (!emergency && owned) {
          // Travelling, and not actually drowning. Say so once in a while so
          // "the reflex stopped firing" is visible as a decision rather than as
          // silence, and leave the body alone.
          if (throttled('swim_yield', 30_000)) {
            logEvent({ kind: 'water_travel_uninterrupted', status: 'success',
                       detail: `crossing with ${airSeconds.toFixed(1)}s air, ` +
                               `air ${airDist === Infinity ? 'unknown' : airDist + 'b'} away` +
                               `${closingOnAir ? ' and closing' : ''} — not seizing`,
                       snapshot: snapshot(bot) })
          }
        }
        // Has this rescue already failed here, with nothing to show for it?
        const hereP = bot.entity?.position
        const movedSinceFail = (drownFailPos && hereP)
          ? drownFailPos.distanceTo(hereP) : Infinity
        const hurtSinceFail = drownFailHealth != null && (bot.health ?? 20) < drownFailHealth
        const suppressed = drownRescueSuppressed({
          failures: drownFails, movedBlocks: movedSinceFail, healthDropped: hurtSinceFail,
          // The route computed for `closingOnAir` above, reused. `sealed` is
          // the only value that may hold suppression across a move, and it is
          // false for an unreadable cell or a scan that ran out of range.
          sealedHere: route?.sealed === true,
        })
        if (suppressed && throttled('drown_yield', 30_000)) {
          logEvent({
            kind: 'drowning_rescue_yielded', status: 'success',
            detail: `${drownFails} ceilings expired here with no air and no harm ` +
                    `(health ${bot.health}, ${route?.sealed === true ? 'still sealed in' : 'moved on'}) ` +
                    `— yielding the body to the escape handlers`,
            snapshot: snapshot(bot),
          })
        }
        if (mayAct && !suppressed && (emergency || !owned) && air.act === 'swim') {
          const route = breathableRoute(bot)
          // SEIZE ONCE. Taking the body means clearing every control state, so
          // doing it per tick destroys the stroke the previous tick started.
          if (!rescuing) {
            rescuing = true
            seizedAt = Date.now()
            headOutSince = 0
            // `drowning_reentry` was logged here, 144,356 times. It graded a
            // release by whether the bot came back into the water. Under the
            // model that swimming is travel, coming back into the water is not
            // evidence the release failed -- it is a bot going somewhere. The
            // event measured compliance with a goal the bot never had.
            lastProgressAt = Date.now()
            bestHomeDist = Infinity
            seizeBody(bot, 'drowning')
            // WHICH WAY, on every rescue -- not just the hopeless ones. Logging
            // only the sealed case left no way to tell whether "up" or "out" was
            // chosen, which is exactly the blind spot that cost three days on the
            // movement bug. Direction and distance, once per rescue.
            logEvent({
              kind: 'drowning_route',
              // `sealed` AND `unscanned` USED TO SHARE A WORD, and that is how
              // "the bots have a way out two blocks sideways" survived reading.
              // A scan that ran out of range in open water is not a wall.
              detail: `${route.dir ?? (route.sealed ? 'sealed' : 'unscanned')} ` +
                      `dist=${route.dist === Infinity ? -1 : route.dist} ` +
                      `at ${Math.round(bot.entity?.position?.x ?? 0)},` +
                      `${Math.round(bot.entity?.position?.y ?? 0)},` +
                      `${Math.round(bot.entity?.position?.z ?? 0)}`,
              snapshot: snapshot(bot),
            })
          }
          // Re-assert steering every tick. setControlState is idempotent, so this
          // holds the stroke instead of restarting it, and no timeout is armed to
          // cut it short -- the release happens when the bot can breathe again.
          //
          // TWO PHASES, because the rescue is graded on reaching LAND and used
          // to pursue only AIR. Once the lungs are refilling, the nearest air is
          // the surface the bot is already touching and steering at it means
          // holding still -- so the second phase re-aims at something the bot
          // could stand on. Shore is only scanned in that phase: it is a
          // radius-10 block sweep, too costly to run while the urgent swim is
          // the right answer anyway.
          const ctl = drowningControls({ losing: true, ashore: false, route, shore: null })
          if (ctl.lookAt) { try { bot.lookAt(ctl.lookAt, true) } catch { /* not connected */ } }
          bot.setControlState('forward', ctl.forward)
          bot.setControlState('jump', ctl.jump)
          if (ctl.phase !== lastDrownPhase) {
            lastDrownPhase = ctl.phase
            logEvent({ kind: `drowning_${ctl.phase}`, status: 'success',
                       detail: `phase ${ctl.phase}`, snapshot: snapshot(bot) })
          }
          return
        }
      } else if (air.suspect && !badOxygenReported) {
        badOxygenReported = true
        log('warn', 'reflex: low oxygen with clear head -- reading not actionable', {
          oxygen: bot.oxygenLevel, head: head?.name ?? 'unknown', health: bot.health,
        })
        logEvent({
          kind: 'oxygen_reading_suspect',
          detail: `oxygen ${bot.oxygenLevel} but head block is ${head?.name ?? 'unknown'} ` +
                  `and health is ${bot.health}; not interrupting`,
          snapshot: snapshot(bot),
        })
      }

        // Suffocating on land means walled in, and the ONLY thing that frees a
        // bot with canDig=false is the entombed handler below, which pillars or
        // digs straight up. Two corrections to my own 23:38 change:
        //
        //   - It returned unconditionally while oxygen was low, so a suffocating
        //     bot skipped the entombed, stuck, health and hunger checks on every
        //     tick -- it could never reach the one routine that would free it.
        //     Scout01 sat walled in at -6,71,-24 for an hour, identical to 15
        //     decimal places, while this returned early ~2000 times.
        //   - It called escape(), a 1.5s sprint. Sprinting into stone when all
        //     six faces are solid does nothing.
        //
        // So: fall through. Do not return.
      // Hysteresis band, matching the health check: clear only once oxygen has
      // genuinely recovered, so one incident is one reaction.
      // Hysteresis in the same units as the trigger: clear once air is back above
      // half. Hardcoding 12 meant that on a 400-tick scale the latch cleared while
      // the bot still had 3% of its air, so one incident logged as many.
      if (bot.oxygenLevel != null && bot.oxygenLevel >= airMax * 0.5) lowOxygenLatched = false

      // --- standing in something that hurts --------------------------------
      const feet = bot.blockAt(bot.entity.position)
      const below = bot.blockAt(bot.entity.position.offset(0, -1, 0))
      if ((DANGER_BLOCKS.has(feet?.name) || DANGER_BLOCKS.has(below?.name)) && throttled('danger', 8000)) {
        log('error', 'reflex: in danger block, escaping', { block: feet?.name ?? below?.name })
        logEvent({ kind: 'reflex_danger_block', detail: feet?.name ?? below?.name, snapshot: snapshot(bot) })
        runner.interrupt('danger_block')
        await escape(bot)
        return
      }

      // --- health ----------------------------------------------------------
      // Latched, not level-triggered. Firing on every tick while health is low
      // produced ~10 log lines/sec and repeated interrupts; the latch clears
      // only once health actually recovers, so one dip is one reaction.
      if (bot.health != null && bot.health <= config.reflex.fleeBelowHealth) {
        if (!lowHealthLatched && throttled('low_health', 15000)) {
          lowHealthLatched = true
          log('warn', 'reflex: health low, disengaging', { health: round1(bot.health) })
          logEvent({ kind: 'reflex_low_health', detail: `health ${round1(bot.health)}`, snapshot: snapshot(bot) })
          if (runner.isBusy()) runner.interrupt('low_health')
        }
      } else if (bot.health != null && bot.health > config.reflex.fleeBelowHealth + 4) {
        lowHealthLatched = false   // hysteresis band avoids flapping at the threshold
      }

      // --- hunger -----------------------------------------------------------
      if (!eating && bot.food != null && bot.food <= config.reflex.eatBelowFood) {
        const food = pickFood(bot)
        if (food) {
          eating = true
          try {
            await bot.equip(food, 'hand')
            await bot.consume()
            log('info', 'reflex: ate', { item: food.name, food: bot.food })
            logEvent({ kind: 'reflex_ate', detail: food.name, snapshot: snapshot(bot) })
          } catch (e) {
            log('debug', 'reflex: eat failed', { err: e.message })
          } finally {
            eating = false
          }
        }
      }

      // --- marooned: no route out, but up is open ----------------------------
      //
      // `mine` digs down. Navigation runs canDig=false and
      // allow1by1towers=false. So ONE COMPONENT CAN CREATE TOPOLOGY THE REST OF
      // THE STACK CANNOT TRAVERSE, and the bot that dug the shaft is the one bot
      // that cannot climb it. Miner01 sat at the bottom of its own forty-block
      // shaft for ninety minutes at 20/20 health with 70 cobblestone and two
      // pickaxes: no hazard, no shortage, no damage. Nothing rescued it because
      // every guard tested a SHAPE -- head blocked, not moving, low health --
      // and none tested the thing that was actually false: that it could get
      // anywhere from here.
      //
      // So this branch tests capability directly. Not "am I walled in" but "can
      // a journey begin at all", which is what the trap denies and what
      // canStartAPath() measures. Cheap guards first, because that call runs a
      // real search and this loop ticks twice a second.
      if (!escaping && !marooned && !runner.isBusy() &&
          Date.now() - lastMaroonCheck > MAROON_CHECK_MS) {
        lastMaroonCheck = Date.now()
        const above = bot.blockAt(bot.entity.position.offset(0, 2, 0))
        // ONE PREDICATE WITH `isEntombed`, OR THE TWO BRANCHES LEAVE A GAP.
        // This was a bare bounding-box test and `isEntombed` was a name list;
        // `maroonState` returns 'none' whenever `!upIsOpen`, so any cell the
        // two disagreed about reached neither handler. `bodyPassable` is now
        // both. It also closes the column on LAVA, which the bounding-box test
        // called open because lava reports an empty box -- a bot under lava is
        // not one pillar away from anywhere.
        const upIsOpen = !above || bodyPassable(above)
        // COUNT, not `.some()`. The boolean stays because other readers use it,
        // but the count is what `maroonState` needs to tell "can climb" from
        // "will be refused for want of twenty-four more".
        const blockCount = bot.inventory.items()
          .filter(it => PLACEABLE.test(it.name))
          .reduce((n, it) => n + it.count, 0)
        const haveBlocks = blockCount > 0
        // ONE DECISION, not two overlapping conditions. See maroonState().
        // CHEAP GUARDS FIRST. canStartAPath() runs a real search, and the
        // original condition short-circuited before reaching it. Computing the
        // state eagerly would pay for that search on every check regardless of
        // whether the column is even open.
        const entombedNow = isEntombed(bot)
        const canStartPath = (!upIsOpen || entombedNow) ? true : await canStartAPath(bot)
        const cappedNeedsTool = (!upIsOpen || entombedNow || canStartPath)
          ? false
          : !!shaftCapNeedsTool(bot)
        const mstate = (!upIsOpen || entombedNow)
          ? 'none'
          : maroonState({ upIsOpen, haveBlocks, blockCount, climbNeed: PILLAR_MAX_BLOCKS, entombed: entombedNow,
                          canStartPath, cappedNeedsTool,
                          y: bot.entity?.position?.y })
        if (mstate === 'need_scaffold' &&
            Date.now() - lastMaroonPrereqAt > MAROON_PREREQ_COOLDOWN_MS) {
          lastMaroonPrereqAt = Date.now()
          // TAKE THE WALL BEFORE ASKING ANYONE FOR ANYTHING.
          //
          // Handing this to the goal layer first is what measured 0/8 across 453
          // expired prerequisites. The bot cannot travel -- that is why it is
          // here -- so the fetch it was being asked to perform was impossible by
          // construction. Its own walls are made of the thing it needs.
          const yNow = Math.round(bot.entity.position.y)
          const invBefore = inventorySummary(bot)
          const got = await harvestAdjacent(bot).catch(e => {
            log('warn', 'reflex: adjacent harvest failed', { err: e.message })
            return { gained: 0, dug: 0, tried: 0, unsafe: 0 }
          })
          // A CAPABILITY IS NOT SHIPPED UNTIL THE OBSERVATION NAMES IT. Without
          // this, a bot ringed by lava reports the identical string as a bot
          // standing on bedrock -- "0/0 dug" -- and both the model and the next
          // person reading the telemetry would call it a vocabulary miss.
          const lavaNote = got.unsafe
            ? ` (${got.unsafe} below-level neighbour(s) refused: lava)` : ''
          if (got.gained > 0) {
            noteReflexInventory(bot, invBefore, 'maroon_harvest')
            logEvent({ kind: 'marooned_self_sourced', status: 'success',
                       detail: `no route from y=${yNow}; dug ${got.dug} of ${got.tried} ` +
                               `neighbouring block(s) and gained ${got.gained} placeable — ` +
                               `haveBlocks is now true, so the next check climbs`,
                       snapshot: snapshot(bot) })
          } else {
            // NOTHING TO TAKE IS NOT NOTHING TO DO.
            //
            // This branch used to go straight to the goal layer, and that was
            // the trap. `got.tried > 0` with `got.dug === 0` -- 71.4% of every
            // self-sourcing failure the fleet has logged, 37,778 parsed -- means
            // the walls ARE in the vocabulary and simply cannot be harvested by
            // an empty hand. Stone drops nothing bare-handed. So the ask that
            // followed ("gather 8 dirt or cobblestone") was addressed to a bot
            // whose defining property is that it cannot travel, and 453 of 479
            // such prerequisites expired at the TTL with `had 0/8`. Thirteen
            // bots have been standing in this branch, several for over ten days.
            //
            // A RAMP NEEDS NO MATERIALS. Before handing the problem to a layer
            // that cannot solve it, cut one. This is deliberately control flow
            // and not a sentence added to the prompt: the correct remedy was
            // already being PRINTED 262 times to a model that never acted on it,
            // and the lesson written down from that is that advice printed is
            // not advice taken.
            // YIELDS TO THE WATER RESCUE, NEVER THE OTHER WAY ROUND. This loop
            // holds the body for up to a minute and clears the controls at every
            // step boundary, and the drowning branch runs in the same tick loop
            // -- so without this it wipes a stroke a drowning bot is depending
            // on. A ramp resumes from the step it stopped on; a drowning bot
            // does not resume.
            const ramp = await escapeStairUp(bot, { yieldTo: drowningOwnsBody }).catch(e => {
              log('warn', 'reflex: escape ramp failed', { err: e.message })
              return { steps: 0, climbed: 0, breached: 0, stopped: `threw: ${e.message}` }
            })
            // ONE KIND, BOTH OUTCOMES. Logging only the successes made the
            // ramp's success rate 100% by construction and buried its
            // denominator inside a different label's `detail` string. The
            // status carries the outcome and `steps=` carries the size, so the
            // rate is computable without parsing prose.
            logEvent({ kind: 'marooned_ramp_cut',
                       status: rampStatus(ramp),
                       detail: `no route from y=${yNow} and ${got.tried} adjacent block(s) ` +
                               `yielded nothing when dug${lavaNote}; steps=${ramp.steps} ` +
                               `climbed=${ramp.climbed.toFixed(1)} — stopped because ${ramp.stopped}`,
                       snapshot: snapshot(bot) })
            // BEFORE ASKING FOR MATERIALS, TRY THE ONE CELL NOBODY WAS LOOKING AT.
            //
            // The ramp needs a solid LATERAL neighbour to cut a tread into. A bot
            // stranded on a pillar has air on all four cardinals by the definition
            // of stranded, so `steps` comes back 0 -- and the branch below then asks
            // a bot that cannot travel to go and fetch scaffold. 453 of 479 such
            // prerequisites expired reading `had 0/8`.
            //
            // The block under its feet is solid, is one it placed itself, and
            // breaking it descends one AND yields material. It is the cheapest rung
            // there is, and it was missing from the offset list because that list
            // could not price a fall. `mayHarvestUnderfoot` can.
            let underfoot = null
            if (ramp.steps === 0) {
              underfoot = await harvestUnderfoot(bot)
                .catch(e => ({ ok: false, why: `threw: ${e.message}` }))
              logEvent({ kind: 'marooned_underfoot',
                         status: underfoot.ok ? 'success' : 'failed',
                         detail: `ramp found no tread at y=${yNow}; underfoot dig ${underfoot.why}` +
                                 (underfoot.drop != null ? ` (drop=${underfoot.drop})` : ''),
                         snapshot: snapshot(bot) })
            }
            if (ramp.steps === 0 && !underfoot?.ok) {
              // THE RAMP REFUSED TOO, AND ONLY NOW IS THE GOAL LAYER RIGHT.
              //
              // Reaching here leaves the bot in EXACTLY the state this branch
              // left it in before the ramp existed -- same position, same
              // inventory, same prerequisite. That is the property that makes
              // this safe to add: a capability that refuses can subtract no
              // move the bot already had, so no composition of it with an
              // existing guard can manufacture a new dead end. The ramp's own
              // reason rides along, because "no tread to stand on" and "lava
              // against the step" are different worlds and a zero cannot tell
              // them apart.
              bot.pendingPrereq = scaffoldPrereq(
                `no path can start from y=${yNow}, nothing in the inventory to pillar ` +
                `with, ${got.tried} adjacent block(s) yielded nothing when dug${lavaNote}, ` +
                `and no escape ramp could be cut (${ramp.stopped})`)
              logEvent({ kind: 'marooned_needs_scaffold', status: 'failed',
                         detail: `no route from y=${yNow}, column above is open, no placeable ` +
                                 `blocks, self-sourcing failed (${got.dug}/${got.tried} dug)` +
                                 `${lavaNote}, and the escape ramp stopped because ` +
                                 `${ramp.stopped} — asked for scaffold`,
                         snapshot: snapshot(bot) })
            }
          }
        }
        if (mstate === 'need_pickaxe' &&
            Date.now() - lastMaroonPrereqAt > MAROON_PREREQ_COOLDOWN_MS) {
          lastMaroonPrereqAt = Date.now()
          const cap = shaftCapNeedsTool(bot)
          bot.pendingPrereq = pickaxePrereq(
            `no path can start from y=${Math.round(bot.entity.position.y)}; ` +
            `the open shaft is capped by ${cap?.block?.name ?? 'a hard block'} ` +
            `${cap ? `${cap.dy} blocks overhead` : 'overhead'}`)
          logEvent({ kind: 'marooned_needs_pickaxe', status: 'failed',
                     detail: `no route from y=${Math.round(bot.entity.position.y)}, column above ` +
                             `is capped by ${cap?.block?.name ?? 'a hard block'}, and no usable tool ` +
                             `is available — asked for pickaxe`,
                     snapshot: snapshot(bot) })
        }
        // STRANDED ABOVE EVERYTHING, not trapped under it. Pillaring is what got
        // the bot here and cannot get it out; the direction it needs is down,
        // and planning a descent is cognitive work, not a 500ms reflex.
        if (mstate === 'stranded_high' &&
            Date.now() - lastMaroonPrereqAt > MAROON_PREREQ_COOLDOWN_MS) {
          lastMaroonPrereqAt = Date.now()
          const yNow = Math.round(bot.entity.position.y)
          logEvent({ kind: 'marooned_stranded_high', status: 'failed',
                     detail: `no route from y=${yNow}, which is at or above the climb ceiling ` +
                             `of ${CLIMB_CEILING} — the column above is open because the build ` +
                             `limit is, not because there is anywhere to go. Climbing cannot ` +
                             `help; this bot needs to descend`,
                     snapshot: snapshot(bot) })
          runner.interrupt('stranded_high')
        }

        if (mstate === 'climb') {

          marooned = true
          const invBefore = inventorySummary(bot)
          const yBefore = bot.entity.position.y
          log('error', 'reflex: marooned -- no route from here, climbing out', {
            y: Math.round(yBefore),
            blocks: bot.inventory.items().filter(it => PLACEABLE.test(it.name))
              .reduce((n, it) => n + it.count, 0),
          })
          logEvent({ kind: 'marooned', status: 'failed',
                     detail: `no path can start from y=${Math.round(yBefore)} with an open ` +
                             `column above -- climbing out`,
                     snapshot: snapshot(bot) })
          runner.interrupt('marooned')
          // THE RETURN VALUE WAS THROWN AWAY, AND IT IS THE WHOLE OUTCOME.
          //
          // `pillarOut` answers 'needs_blocks' | 'exhausted' | undefined-on-success.
          // The ENTOMBED branch reads it and escalates; this one discarded it, so a
          // refusal was indistinguishable from a rescue. Measured 2026-09-04 over
          // 6h: board-c-Delta logged `marooned` 350 times and `maroon_climb_refused`
          // 350 times -- a 1:1 pairing, every detection ending in a refusal nobody
          // acted on, then silence, 350 times over.
          //
          // So: mirror what entombment already does, because it is already right.
          // A refusal for want of material falls through to the bare-handed ramp,
          // which needs no material at all. If the ramp also declines the bot is in
          // exactly the state this branch would have left it in anyway -- same cell,
          // same inventory -- and now both reasons are on the record instead of none.
          let pillarOutcome = null
          try { pillarOutcome = await pillarOut(bot) }
          catch (e) { log('warn', 'maroon escape failed', { err: e.message }); pillarOutcome = 'threw' }

          if (pillarOutcome === 'needs_blocks' || pillarOutcome === 'exhausted') {
            // RECORDED, NOT RE-REMEDIED.
            //
            // The first version of this fix cut a second ramp here, which was
            // redundant and broke a rule the suite enforces: `marooned_ramp_cut`
            // is emitted from exactly ONE place, so that success and failure keep
            // a shared denominator. The suite caught it.
            //
            // It is redundant because the sibling fix routes the common case
            // elsewhere. `maroonState` now compares the block COUNT against what
            // `canFinishClimb` demands, so a bot holding 1..24 no longer arrives
            // here at all -- it reaches `need_scaffold`, which already
            // self-sources, cuts the ramp, and handles `steps === 0`.
            //
            // What is left is a bot that HAD enough and still could not finish.
            // There is no cheaper remedy to reach for, and inventing one here
            // would be guessing. So: say so, once, with the reason on it. A
            // refusal that is recorded is a funnel; a refusal that is discarded
            // is the 350-to-350 silence this whole change exists to end.
            logEvent({ kind: 'maroon_pillar_declined', status: 'failed',
                       detail: `pillar declined (${pillarOutcome}) from y=` +
                               `${Math.round(bot.entity?.position?.y ?? 0)} — recorded rather ` +
                               `than discarded; no cheaper remedy applies at this block count`,
                       snapshot: snapshot(bot) })
          }
          noteReflexInventory(bot, invBefore, 'maroon_escape')
          marooned = false
        }
      }

      // --- entombed / stuck in a pit -----------------------------------------
      // `mine` digs downward but navigation runs canDig=false and
      // allow1by1towers=false, so descending is a ONE-WAY TRIP. Observed live:
      // Scout at y=49 with stone on all four sides, 12 blocks below the
      // surrounding ground, unable to dig out or pillar out.
      //
      // This is a survival condition, so it lives here rather than in a skill --
      // it must fire regardless of what the agent thinks it is doing.
      // `!marooned` IS LOAD-BEARING: BEING WALLED IN IS WHAT A PILLAR CLIMB IS.
      //
      // The maroon branch guards itself with `!escaping`, so an entombed escape
      // blocks a maroon climb -- but the guard was never symmetric, and this
      // loop keeps ticking while pillarOut is awaited. Observed on Scout01, who
      // had sat at y=29 for four days: given dirt, the maroon reflex correctly
      // began climbing out, and fourteen seconds later THIS branch looked at a
      // bot standing in a one-block column of its own making, called it
      // entombed, and dug it back down. It spent 7 dirt to return to the exact
      // block it started on.
      //
      // A bot mid-climb is sealed in by design. Only the climb may decide the
      // climb has failed.
      // A SKILL-LAYER CLIMB IS SEALED IN BY DESIGN, exactly as the comment above
      // says. `escaping` covers this reflex's OWN pillar; nothing covered the
      // one `surface` runs. So the reflex saw a bot in a one-block column of a
      // skill's making, called it entombed, tried its own pillar, had that
      // refused for want of blocks -- and disturbed the body anyway, killing a
      // dig that was already in progress. Observed as
      // `dig failed on stone: Digging aborted`, up to eight interrupts inside a
      // single 120s surface budget.
      //
      // TYPED, and deliberately the only reader. There is no `hasClaim()`:
      // "is any skill running?" would stand this reflex down for `mine`, the
      // skill that digs the trap in the first place, and it is the same
      // question as `owned = !!pathfinder.goal`, which cost 42 of 45 drowning
      // deaths while idle. A 'climb' claim can quiet this branch and nothing
      // else -- no water path reads it.
      const climbing = !!runner?.bodyClaimFor?.('climb')
      if (!escaping && !marooned && !climbing && isEntombed(bot) &&
          Date.now() - lastEscapeAt > ESCAPE_MIN_INTERVAL_MS) {
        if (escapeFailures >= ESCAPE_GIVE_UP_AFTER) {
          // Hand it to the watchdog, which can relocate, go home, or reconnect.
          // Repeating an escape that has failed four times is not a strategy.
          escapeGiveUps++
          // ASK FOR THE THING THAT IS MISSING.
          //
          // A bot walled into deepslate with 64 dirt and no pickaxe is not
          // having bad luck, it is short one item -- pillaring cannot gain
          // height against a solid ceiling, and bare-handed deepslate takes
          // ~11s per block, well past the dig budget. The escape is
          // arithmetically impossible and no amount of retrying changes that.
          // The goal layer can fix it (craft or fetch a pickaxe) but only if
          // it is told, so hand it the prerequisite the same way skills do.
          // `bot` is this codebase's shared bus (assertNav, withAscentMovements
          // ride it too); cognitive.mjs drains this on its next tick.
          bot.pendingPrereq = {
            items: ['wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'diamond_pickaxe'],
            count: 1,
            describe: 'Get a pickaxe. You are sealed in and cannot break the ceiling without one.',
            because: `${escapeGiveUps} escape attempts could not break out at y=${Math.round(bot.entity.position.y)}`,
          }
          logEvent({ kind: 'entombed_unrecoverable', status: 'failed',
                     detail: `gave up after ${escapeFailures} escape attempts at ` +
                             `y=${Math.round(bot.entity.position.y)} (give-up #${escapeGiveUps}); ` +
                             `asked the goal layer for a pickaxe`,
                     snapshot: snapshot(bot) })
          // Say what actually happens. The old line claimed the watchdog would
          // take it, and the watchdog does not watch for this.
          log('error', 'reflex: entombed and cannot escape; asked the goal layer for a pickaxe',
              { attempts: escapeFailures, giveUps: escapeGiveUps })
          // BACK OFF, don't reset. Retrying an impossible escape every 15s
          // buries the telemetry that says this bot is finished, and burns the
          // tick budget of a bot that needs the cognitive layer to act instead.
          lastEscapeAt = Date.now() + Math.min(escapeGiveUps * 60_000, 10 * 60_000)
          escapeFailures = 0
          return
        }
        escaping = true
        // THE FLAG MUST BE PUT DOWN EVEN WHEN THE BODY THROWS.
        //
        // `escaping` gates BOTH this branch and the maroon branch, and it is the
        // only thing that stops a second tick disturbing a climb already in
        // flight. It used to be cleared by a plain assignment at the end, so any
        // throw between here and there -- `snapshot(bot)` on a half-connected bot,
        // `logEvent` on a full disk -- landed in the tick-level catch with the flag
        // still true, and this bot never attempted another escape for the life of
        // the process. A latch with no `finally` is a latch that eventually sticks.
        try {
          lastEscapeAt = Date.now()
          const yBefore = bot.entity.position.y
          shareHazard('entombed', bot.entity?.position)
          logEvent({ kind: 'entombed', status: 'failed',
                     detail: `walled in at y=${Math.round(bot.entity.position.y)}`,
                     snapshot: snapshot(bot) })
          log('error', 'reflex: entombed, pillaring out', { y: Math.round(bot.entity.position.y) })
          runner.interrupt('entombed')
          // Bracket the whole escape, not each helper: pillarOut may hand off to
          // digStraightUp partway through, and what matters is the net cost of
          // getting out of the hole, attributed to the reflex that caused it.
          const invBefore = inventorySummary(bot)
          // CAPTURE THE ANSWER. pillarOut already returns false when it declines
          // to start, and that value was being dropped -- which is why a refusal
          // could not be told apart from an attempt that went nowhere.
          let climbed = null
          try { climbed = await pillarOut(bot) }
          catch (e) { log('warn', 'pillar out failed', { err: e.message }) }
          noteReflexInventory(bot, invBefore, 'entombed_escape')
          // Verify the postcondition. "I ran the recovery" and "the bot is no
          // longer trapped" are different claims and only the second one counts.
          // A REFUSAL IS NOT A FAILED ESCAPE.
          //
          // `pillarOut` returns false without moving when `canFinishClimb`
          // declines -- the reflex correctly deciding not to seal the bot higher
          // than it started. That was scored here as a failure anyway, so four
          // refusals at 15s intervals reached ESCAPE_GIVE_UP_AFTER in a minute,
          // emitted `_entombed_unrecoverable`, backed off, then re-armed and did
          // it again. Declining to act is not evidence that acting failed.
          // ASK FOR WHAT IS ACTUALLY MISSING.
          //
          // `pillarOut` declines for three different reasons and used to answer
          // all of them with a bare `false`. Two of the four return paths run
          // through `digStraightUp`, which refuses when `mayDigForEscape` says the
          // bot has no pickaxe to spare -- and that is the DOMINANT shape here,
          // because 28 of the 32 frozen bots hold zero pickaxes. Answering it with
          // "gather blocks" sends a bot that is short a tool to go and fetch
          // gravel.
          //
          // A refusal is still not a failed escape: nothing was attempted, so
          // there is nothing to have failed. But it must not spin either, so it
          // asks for the missing thing and backs off on an ESCALATING curve --
          // `climbRefusals` is deliberately NOT reset, for the same reason
          // `escapeGiveUps` is not: a flat backoff on a permanently blocked bot
          // interrupts running skills forever at a fixed rate.
          // 'exhausted' is NOT a refusal: the pillar ran out of blocks PARTWAY,
          // which its own log line says leaves the bot worse off than when it
          // started. That is an attempt that failed and belongs in the failure
          // arm. Only a decline-to-start counts as a refusal.
          if (climbed === 'needs_blocks' || climbed === 'needs_pickaxe') {
            // TWO COUNTERS, BECAUSE THEY ANSWER TWO QUESTIONS.
            //
            // `climbRefusals` is a LIFETIME total and drives the escalating
            // backoff and the prerequisite -- both of which must keep working for
            // a bot that moves. `refusalStreak` is scoped to a PLACE and gates
            // only the ramp, because the ramp digs and four refusals in four
            // counties must not buy what four refusals in one pocket buys.
            //
            // Folding them into one variable deleted the backoff outright. For a
            // bot that MOVES the scoped streak is 1 every time, so
            // `% ESCAPE_GIVE_UP_AFTER === 0` was never true, so the prerequisite,
            // the telemetry and `lastEscapeAt` were all unreachable -- while the
            // branch still fired every 15s and still called `runner.interrupt`.
            // That is 21.0% of firings getting an interrupt every fifteen seconds
            // forever with no backoff and no record, which is precisely what the
            // comment above says the non-resetting counter exists to prevent.
            climbRefusals++
            refusalPlaceStreak = refusalStreak(refusalPlaceStreak, lastRefusalPos,
                                               bot.entity?.position)
            lastRefusalPos = bot.entity?.position?.clone?.() ?? bot.entity?.position ?? null
            const esc = refusalEscalation({ refusals: climbRefusals,
                                            streak: refusalPlaceStreak })
            if (esc.due) {
              // CUT A RAMP BEFORE ASKING FOR MATERIALS, BECAUSE A RAMP NEEDS NONE.
              //
              // This is where the trap actually lived. `pillarOut` refuses on a
              // FIXED 24-block climb -- `PILLAR_MAX_BLOCKS`, not a measurement of
              // this bot's ceiling -- and entombment forces `headroomBlocked`, so
              // `canFinishClimb` demands 26 placeable blocks before anything at
              // all happens. Measured on the live fleet, the four bots that have
              // been entombed at one coordinate for the whole 8h window hold 5,
              // 10, 12 and 20, and not one of them holds a pickaxe. They are
              // refused, told to gather 26 dirt, and asked to travel for it by a
              // layer whose defining property is that it cannot travel: 453 of
              // 479 such prerequisites expired at the TTL reading `had 0/8`.
              //
              // Breaking stone bare-handed removes the block and drops nothing,
              // which is exactly what a ramp wants, so the one ascent that costs
              // no materials is available to a bot that can afford nothing. It is
              // control flow and not a sentence in the prompt for the reason
              // already written down here: the correct remedy was PRINTED 262
              // times to a model that never once acted on it.
              //
              // COMPOSES BY SUBTRACTING NOTHING. If the ramp refuses, the bot is
              // in precisely the state this branch left it in before -- same
              // cell, same inventory, same prerequisite, and the ramp's own
              // reason rides along so "sealed under bedrock" and "no tread to
              // stand on" stay distinguishable.
              const stair = esc.ramp ? await escapeStairUp(bot, { yieldTo: drowningOwnsBody })
                .catch(e => {
                  log('warn', 'reflex: entombed escape ramp failed', { err: e.message })
                  return { steps: 0, climbed: 0, breached: 0, stopped: `threw: ${e.message}` }
                }) : null
              if (stair) {
                // ONE KIND, BOTH OUTCOMES, AND `steps` ON IT.
                //
                // The first version logged `entombed_ramp_cut` only on success and
                // folded the failures into `_entombed_needs_blocks`, which made
                // the ramp's success rate 100% by construction and left its
                // denominator recoverable only by string-parsing `stopped`. That
                // is the shape CLAUDE.md names: a metric that conditions on
                // attempts. Now every attempt is one event and the status is the
                // outcome, so `success / (success + failed)` is a rate about
                // something.
                logEvent({ kind: 'entombed_ramp_cut',
                           status: rampStatus(stair),
                           detail: `pillar declined (${climbed}) at y=${Math.round(yBefore)} for want ` +
                                   `of blocks; steps=${stair.steps} breached=${stair.breached} ` +
                                   `climbed=${stair.climbed.toFixed(1)} — stopped because ${stair.stopped}`,
                           snapshot: snapshot(bot) })
              }
              if (stair && stair.steps > 0) {
                // Progress, so stop escalating against it. Unlike a pillar, every
                // step is a permanent walkable improvement carved into the world
                // and the next firing resumes from the top of it.
                climbRefusals = 0
                refusalPlaceStreak = 0
                escapeFailures = 0
              } else {
                // THE BACKOFF AND THE ASK ARE REACHED WHETHER OR NOT THE RAMP RAN.
                // A firing that declined to cut -- because the refusals came from
                // four different places -- still has to be recorded and still has
                // to back off, or it is an unbounded interrupt with no telemetry.
                const rampNote = stair
                  ? `the escape ramp stopped because ${stair.stopped}`
                  : `no ramp was cut: ${refusalPlaceStreak} of the last refusals were from here, ` +
                    `so the bot is not pinned to one hole`
                const want = climbPrereqFor(climbed)
                bot.pendingPrereq = { ...want,
                  because: `the climb declined ${climbRefusals}x (${climbed}) at ` +
                           `y=${Math.round(bot.entity.position.y)} and ${rampNote}` }
                logEvent({ kind: climbed === 'needs_pickaxe' ? 'entombed_needs_pickaxe'
                                                             : 'entombed_needs_blocks',
                           status: 'failed',
                           detail: `pillar declined ${climbRefusals}x (${climbed}) at ` +
                                   `y=${Math.round(bot.entity.position.y)}; ${rampNote}; ` +
                                   `asked the goal layer for ${want.count}x ${want.items[0]}`,
                           snapshot: snapshot(bot) })
                lastEscapeAt = Date.now() + esc.backoffMs
              }
            }
          }
          else if (bot.entity && bot.entity.position.y - yBefore < 1 && isEntombed(bot)) escapeFailures++
          else { escapeFailures = 0; climbRefusals = 0; refusalPlaceStreak = 0 }
        } finally { escaping = false }
        return
      }

      // --- stuck detection --------------------------------------------------
      // Handoff doc S12: "no movement DESPITE AN ACTIVE TASK". That qualifier
      // is load-bearing. Accumulating stillness while idle means the timer is
      // already expired the instant a task starts, and the first skill is
      // killed before it moves -- which is exactly what happened on first run.
      //
      // Digging is also legitimately stationary: a bot mining a vein by hand
      // stands still for many seconds and is working perfectly.
      const p = bot.entity.position
      const digging = bot.targetDigBlock != null
      if (!runner.isBusy() || digging || (lastPos && p.distanceTo(lastPos) > 0.6)) {
        stillSince = Date.now()
      }
      lastPos = p.clone()

      if (runner.isBusy() && !digging && Date.now() - stillSince > config.reflex.stuckSeconds * 1000) {
        log('warn', 'reflex: stuck, cancelling path', { seconds: config.reflex.stuckSeconds })
        logEvent({ kind: 'reflex_stuck', detail: `no movement for ${config.reflex.stuckSeconds}s`, snapshot: snapshot(bot) })
        stillSince = Date.now()
        runner.interrupt('stuck')
        try { bot.pathfinder?.stop() } catch { /* pathfinder may be idle */ }
        await unstick(bot)
      }
    } catch (e) {
      // A reflex loop that throws EVERY tick is not an error to log, it is an
      // outage to escalate. The previous version logged and continued, so a
      // ReferenceError printed twice a second for as long as the bot lived
      // while every survival reflex was silently absent -- and the bot went on
      // making LLM calls and reporting healthy the whole time.
      //
      // Telemetry, so the failure is visible to the analysis loop rather than
      // only in journald, and a hard stop once it is clearly not transient:
      // no reflexes at all is more dangerous than a reconnect.
      reflexErrors++
      log('error', 'reflex loop error', { err: e.message, consecutive: reflexErrors })
      if (reflexErrors === REFLEX_ERROR_ALARM) {
        logEvent({ kind: 'reflex_layer_down', status: 'failed',
                   detail: `reflex loop threw ${reflexErrors} consecutive times: ${e.message}`,
                   snapshot: snapshot(bot) })
      }
      if (reflexErrors >= REFLEX_ERROR_GIVE_UP) {
        log('error', 'reflex: layer is dead, reconnecting to rebuild state',
            { err: e.message, consecutive: reflexErrors })
        reflexErrors = 0
        try { bot.quit('reflex layer down') } catch { /* already gone */ }
      }
      return
    }
    // Only a clean pass proves the layer is actually working.
    reflexErrors = 0
  }, config.reflex.tickMs)

  return () => clearInterval(timer)
}

/** Walls on 3+ sides at head height, and open sky is far above. */
/**
 * WATER IS NOT A WALL, AND IT IS NOT A CEILING.
 *
 * Every test below asked `name !== 'air'`, so water counted as both. Underwater
 * that makes EVERY bot permanently entombed: the escape fires, pillarOut runs
 * for twenty or thirty seconds placing blocks into the sea, and because the
 * reflex loop is serial the oxygen check never gets a tick while it does. A bot
 * drowns in about fifteen seconds.
 *
 * Measured on instance #2: Scout01 drowned 13 times in two hours, 5 of them in
 * one twenty-minute window, with `reflex: drowning` firing ZERO times and
 * `reflex: entombed` firing ten. The wrong rescue was winning every race.
 *
 * You can swim through water. Being surrounded by it is a reason to go UP, which
 * is what the drowning branch already does -- so the fix is simply to stop
 * calling it entombment and let that branch have the tick.
 */
/**
 * IS THIS CELL *NOT* A WALL?
 *
 * DELIBERATELY WIDER THAN `bodyPassable`, and the difference is the whole
 * reason both exist. `bodyPassable` answers "may a body occupy this cell" --
 * geometry, used by anything that is about to move a bot into somewhere.
 * This answers "would a reasonable person call this bot sealed in", and it is
 * used only by the wall count and the higher-ground probe below, where a
 * false positive is a reflex storm rather than a fall.
 *
 * The two extra members are each a scar:
 *   - `water`, because counting it as a wall made an ocean floor read as a pit
 *     and the entombment reflex won every race against the drowning one --
 *     Scout01 drowned 13 times in two hours with `reflex: entombed` firing ten
 *     times and `reflex: drowning` zero.
 *   - `leaves`, because a probe that stops at the first leaf block reports the
 *     canopy of the next tree as nearby high terrain, and every bot in a forest
 *     is then standing at the bottom of a pit.
 *
 * KEEPING THEM OUT OF THE CEILING TEST IS THE POINT. See `isEntombed`.
 */
const notAWall = b =>
  !b || b.name === 'air' || b.name === 'cave_air' || b.name === 'void_air' ||
  b.name === 'water' || b.name === 'bubble_column' || b.name.includes('leaves')

// Kept under the old name for the two readers that want the wide predicate.
const passableFor = notAWall

function isEntombed(bot) {
  const p = bot.entity.position

  // A CEILING is the load-bearing condition and the original version lacked it.
  // Without this, "walls on three sides plus higher ground nearby" describes an
  // ordinary hillside, and the reflex fired 1,997 times in 40 minutes at an
  // average y of 64 -- surface level, open sky overhead. Being genuinely
  // entombed means something is above you.
  //
  // AND THE CEILING IS ASKED THE BODY'S QUESTION, NOT THE WALL'S.
  //
  // This used the wide `notAWall` and it created a dead end of the family
  // CLAUDE.md names: two individually-correct guards meeting where the bot had
  // no legal move. `leaves` report `boundingBox: 'block'`, so the maroon
  // branch's `upIsOpen` -- a bounding-box test -- is FALSE under a canopy; and
  // `leaves` are in `notAWall`, so `isEntombed` was FALSE too. `maroonState` is
  // forced to 'none' whenever `!upIsOpen`, so a bot in a hole with a leaf
  // ceiling reached NEITHER handler and no rescue in this file could see it.
  // `_trapped_in_canopy` used to be a whole reflex of its own; it was removed
  // for "zero effect" and this is where its population went.
  //
  // The remedy is executable from where the bot is, which is the test a new
  // refusal has to pass: oak leaves are hardness 0.2 and come out bare-handed
  // in a fraction of a second, so the ramp that now sees this bot can actually
  // free it. Only the CEILING moves to the narrow predicate -- the wall count
  // and the ground probe keep the wide one, so no forest gains a wall it did
  // not have and the reflex-storm scar above is untouched.
  const ceiling = bot.blockAt(p.offset(0, 2, 0))
  if (bodyPassable(ceiling) || !ceiling) return false

  let walls = 0
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const b = bot.blockAt(p.offset(dx, 1, dz))
    if (!passableFor(b)) walls++
  }
  if (walls < 3) return false
  // Distinguish "in a corridor" from "in a hole": look for ground much higher.
  let highest = -999
  for (const [dx, dz] of [[4, 0], [-4, 0], [0, 4], [0, -4], [4, 4], [-4, -4]]) {
    for (let dy = 12; dy > -2; dy--) {
      const b = bot.blockAt(p.offset(dx, dy, dz))
      // Water is not ground either -- an ocean floor probe that stops at the
      // first water block reports the SURFACE as nearby high terrain, which is
      // how a swimming bot looked like a bot at the bottom of a pit.
      if (!passableFor(b)) {
        if (p.y + dy > highest) highest = p.y + dy
        break
      }
    }
  }
  return highest - p.y >= 4
}

// Breaks bare-handed, so an escape through it costs no tool at all.
const SOFT_BLOCK = /^(dirt|coarse_dirt|rooted_dirt|grass_block|podzol|mycelium|sand|red_sand|gravel|clay|snow|snow_block|dirt_path|farmland|moss_block|mud)$/

const PLACEABLE = /^(dirt|cobblestone|stone|oak_log|oak_planks|sand|gravel|andesite|diorite|granite|deepslate|cobbled_deepslate|sandstone|red_sandstone|dripstone_block|tuff|netherrack|coarse_dirt|rooted_dirt)$/

/**
 * ONE REGEX WAS ANSWERING TWO DIFFERENT QUESTIONS.
 *
 * `PLACEABLE` means "an item in my inventory I can stack under my own feet".
 * Six call sites ask exactly that and are correct. ONE asked something else --
 * "is this adjacent block worth DIGGING for scaffold?" -- and got the wrong
 * answer, because the two sets are not the same set.
 *
 * `grass_block` is the case. It breaks bare-handed and DROPS DIRT, which is the
 * first entry in PLACEABLE. But grass_block itself is not, so `harvestAdjacent`
 * skipped it without ever swinging. Measured over a full walk of the fleet logs
 * (75 files carrying self-sourcing records, 37,392 failures and 150 successes
 * parsed): above sea level 92.3% of failures never tried a single neighbour.
 * A bot standing on a grass hillside could not find a block to pillar with
 * while standing on several thousand of them.
 *
 * THE TRAP ONE LAYER DOWN, and the reason this is derived rather than listed:
 * a candidate is only useful if what it DROPS is placeable.
 *
 *     grass_block  podzol  mycelium  ->  dirt        GOOD
 *     dirt_path    farmland          ->  dirt        GOOD
 *     warped_nylium  crimson_nylium  ->  netherrack  GOOD
 *     clay                           ->  4x clay_ball    an ITEM. BAD.
 *     snow_block / snow              ->  4x snowball     an ITEM. BAD.
 *     mud / packed_mud / moss_block  ->  themselves, and they are not in
 *                                        PLACEABLE, so the bot could not place
 *                                        what it just dug. BAD.
 *
 * Adding `grass_block` to PLACEABLE would have been the cheap fix and it is
 * wrong twice over: it asserts the bot can PLACE grass from its inventory (it
 * cannot -- grass_block is never an item it holds), and it invites the same
 * hand-edit to add clay next to it.
 *
 * So the set is computed from `dropsOf`, which reads minecraft-data for the
 * exact protocol version the bot is connected to -- the same reason drops.mjs
 * refuses to keep a hand table. Verified against the vendored data for BOTH
 * 1.21.8 and 1.21.11: the derived set is the seven blocks above, identically,
 * and every one of the five bad cases above is excluded by the data itself.
 *
 * With no registry this degrades to exactly the old behaviour (PLACEABLE only),
 * because `dropsOf` falls back to the block's own name. That is a silent
 * no-op, not a silent widening.
 */
export function scaffoldCandidate (blockName, registry = null) {
  if (!blockName) return false
  if (PLACEABLE.test(blockName)) return true
  const drops = dropsOf(registry, blockName)
  // EVERY drop, not SOME. A block that yields one placeable item and one
  // useless one is a coin flip, and this is the routine of last resort for a
  // bot that cannot travel. (Against the vendored data the two predicates
  // select the same seven blocks, so this costs nothing today and is the safe
  // side of the ambiguity if a future version splits a loot table.)
  return drops.length > 0 && drops.every(n => PLACEABLE.test(n))
}

/**
 * DO NOT START A CLIMB YOU CANNOT FINISH.
 *
 * This is the single mechanism that manufactures permanent entrapment here.
 * Measured over 12 hours: 23 of 26 permanently-stuck bots emitted a marooned or
 * entombed diagnostic within fifteen minutes of going still, and 20 of 26
 * GAINED ALTITUDE at onset. The sequence is always the same -- the bot cannot
 * travel, the escape seizes the body and pillars up, it runs out of material
 * partway, and it is now sealed in the column it just dug, higher than it
 * started and holding nothing.
 *
 * Fleet-wide the machinery has spent 68,457 oak_log, 35,580 sand, 34,932
 * cobblestone, 22,471 dirt and destroyed 434 pickaxes. It spends the exit in
 * order to escape, and then cannot escape.
 *
 * A partial climb is strictly worse than no climb: it costs the material AND
 * raises the bot further from the ground it needs to reach. So the climb is now
 * all-or-nothing. Refusing to start leaves the bot exactly where it was, with
 * its blocks, which is a recoverable state.
 */
export function canFinishClimb ({ have, need, headroomBlocked = false }) {
  if (!(need > 0)) return true
  // One spare: the topmost placement often mistimes against the jump and has to
  // be repeated. Running out on the last block is the case being prevented.
  const required = need + 1 + (headroomBlocked ? 1 : 0)
  return have >= required
}

/**
 * NEVER SPEND THE LAST PICKAXE ON AN ESCAPE.
 *
 * 24 of the 26 permanently-stuck bots hold ZERO pickaxes, and 574 escape events
 * destroyed one. Without a pickaxe the bot can never dig again, so the escape
 * that breaks it converts a bad state into an unrecoverable one -- and
 * `harvestAdjacent` then fails 99.4% of the time with "0/8 dug", because the
 * walls are stone and there is nothing left to break them with.
 *
 * A tool with one swing left is treated as already gone: durability metadata
 * lags by a tick, and a tool that breaks one swing early is the entire failure
 * being prevented.
 */
export function mayDigForEscape (items = [], block = null) {
  // ONLY WHAT ACTUALLY NEEDS A TOOL.
  //
  // The first version refused ALL escape digging without a spare pickaxe. But
  // dirt, sand and gravel break bare-handed -- the pickaxe only matters for
  // stone. On the canary that turned two bots which were at least TRYING into
  // two bots doing nothing: board-c-Alpha 33 refusals and board-c-Echo 39, both
  // stationary. Gating a whole capability on a tool most blocking blocks do not
  // need is the same over-broad predicate that widened isWet() into kelp and
  // drowned bots.
  //
  // A block we cannot identify is treated as needing the tool, because the
  // stone case is the one that ends escapes permanently.
  if (block && block.boundingBox === 'empty') return true
  if (block && SOFT_BLOCK.test(block.name)) return true
  let usable = 0
  for (const it of items) {
    if (!it?.name || !/_pickaxe$/.test(it.name)) continue
    // Unknown durability counts as FULL, not as spent. Assuming a tool is dead
    // when the server does not report durability would refuse every escape --
    // a different total outage, arriving through the safety guard.
    const max = it.maxDurability
    const left = max ? max - (it.durabilityUsed ?? 0) : Infinity
    if (left > 1) usable += 1
  }
  return usable > 1
}
const TOOL_TIER = ['wooden', 'golden', 'stone', 'iron', 'diamond', 'netherite']
const toolTier = name => TOOL_TIER.findIndex(t => name.startsWith(t + '_'))

function bestTool(bot, block) {
  let best = null, bestTime = Infinity
  for (const it of bot.inventory.items()) {
    if (!block.canHarvest?.(it.type)) continue
    const t = block.digTime?.(it.type, false, false, false) ?? Infinity
    if (t < bestTime || (t === bestTime && best && toolTier(it.name) > toolTier(best.name))) {
      bestTime = t
      best = it
    }
  }
  return best
}

function shaftCap(bot, maxClearance = 12) {
  const p = bot.entity.position
  for (let dy = 2; dy <= maxClearance; dy++) {
    const b = bot.blockAt(p.offset(0, dy, 0))
    if (!passableFor(b)) return { block: b, dy }
  }
  return null
}

export function shaftCapNeedsTool(bot, maxClearance = 12) {
  const cap = shaftCap(bot, maxClearance)
  if (!cap) return null
  const handCanHarvest = cap.block.canHarvest?.(null) === true
  if (handCanHarvest || bestTool(bot, cap.block)) return null
  return cap
}

/**
 * Escape a pit. Two failure modes the first version got wrong:
 *
 *  1. It jumped without checking HEADROOM. With a stone ceiling directly above,
 *     jump-and-place does nothing -- observed running 20 times at y=61 while
 *     going nowhere.
 *  2. It reported success unconditionally. "pillared out from=61 to=61" is a
 *     lie, and it hid the failure from both the log and the caller.
 *
 * Now: clear the ceiling first, verify height was actually gained, and fall
 * back to digging straight up when pillaring cannot work.
 */
// Sides at foot and head height, then the four DIAGONAL-DOWN neighbours.
//
// NEVER the ceiling (that column is the escape route and pillarOut owns it) and
// NEVER [0,-1,0], the block the bot is standing on. Both exclusions are load
// bearing and the second one is the interesting one:
//
//   - pillarOut places against `blockAt(position.offset(0,-1,0))` and gives up
//     with `if (!below) break`. Digging the floor deletes the thing the very
//     next step needs.
//   - It also drops the bot one block, which is the trade "one block of height
//     for one block of inventory" -- and height is exactly what a marooned bot
//     is short of. `mine` refuses to break a floor with a hollow under it for
//     the same reason, and this routine has no such probe.
//
// The DIAGONAL-down neighbours have neither problem: they are not under the
// bot, so nothing falls and nothing pillarOut needs is removed, and they are
// where a surface bot's dirt actually is. On flat ground the ONLY solid blocks
// near a standing bot are at foot-1 level, which is why the old eight offsets
// found nothing 92.3% of the time above sea level. Widening the vocabulary
// without these offsets does not fix flat ground, and adding these offsets
// without the vocabulary does not either -- on grass, both are required.
//
// THREE HAZARDS WERE CONSIDERED FOR THE FOUR NEW CELLS. Two are decisions, not
// omissions, and they are written down so the next reader does not have to
// guess whether anyone looked:
//
//   LAVA -- GUARDED. See harvestSafe in scaffold.mjs. Opening a cell at foot-1
//     lets lava flow in flush with the bot's feet, and fire is 12% of deaths at
//     1.47 per bot per day. This routine runs when a bot is stuck and out of
//     options, which is the worst moment to open a new burn vector.
//
//   GRAVITY -- NOT GUARDED, deliberately. sand and gravel are candidates, so
//     digging [1,-1,0] can drop the column above it. But that column is not the
//     one the bot is standing in, the drop has already been collected before
//     anything falls, and the falling block lands in the hole rather than on the
//     bot. The cost is a refilled cell, which is cosmetic. (scaffold.mjs exports
//     FALLING if a future case ever makes this worth tightening.)
//
//   VOID BELOW -- NOT GUARDED, deliberately. Breaking a diagonal-down block over
//     a cave opens a hole one step away. The bot never enters that cell -- it
//     digs from where it stands -- and its own support is excluded from this
//     list, so there is no fall vector. `mine` needs its hollow-floor probe
//     because a staircase bot WALKS INTO the tread it just cut; this one does
//     not, and adding the probe would refuse cells for a fall that cannot
//     happen.
/**
 * BREAK THE BLOCK YOU ARE STANDING ON, AND DESCEND ONE.
 *
 * `HARVEST_OFFSETS` deliberately omits `[0,-1,0]`, and it was right to: every
 * other offset opens a cell BESIDE the feet, this one opens the cell UNDER them
 * and the bot falls. `harvestSafe` cannot price that -- it looks for lava and
 * nothing else -- so this cell gets its own routine rather than a list entry.
 *
 * It is worth the routine because it is the cheapest rung there is. For a bot
 * marooned on a pillar the block underfoot is one it placed itself, so breaking
 * it costs nothing, yields material, AND moves the bot in the only direction
 * that helps. Every other remedy either spends blocks it has not got or goes up,
 * which is the direction that stranded it.
 *
 * NO `canHarvest` GATE, and that is deliberate. `canHarvest` answers "will this
 * DROP something", which is the right question for `harvestAdjacent` (whose job
 * is material) and the wrong one here (whose job is descent). `escapeStairUp`
 * already makes this distinction with `needsDrop: false`; bare-handed stone
 * drops nothing and breaks fine, and the hole is what we came for.
 */
async function harvestUnderfoot (bot, { maxProbe = 24, budgetMs = 6000 } = {}) {
  const pos = bot.entity?.position
  if (!pos) return { ok: false, why: 'no position' }
  const target = bot.blockAt(pos.offset(0, -1, 0))
  if (!target || target.boundingBox !== 'block') return { ok: false, why: 'nothing solid underfoot' }

  const risk = harvestSafe({ at: (a, c, d) => bot.blockAt(pos.offset(a, c, d)),
                             dx: 0, dy: -1, dz: 0 })
  if (risk) return { ok: false, why: risk }

  // PRICE THE FALL. Feet at y, target at y-1. If the next solid cell is at y-d
  // the bot lands on top of it, at y-d+1, so it falls d-1. `null` means the
  // probe never found a floor, and an unmeasured drop is refused -- breaking
  // your own floor over a void you never saw the bottom of is not recoverable.
  let drop = null
  for (let d = 2; d <= maxProbe; d++) {
    const b = bot.blockAt(pos.offset(0, -d, 0))
    if (!b) break
    if (b.boundingBox === 'block') { drop = d - 1; break }
  }
  if (!mayHarvestUnderfoot({ drop, health: bot.health })) {
    return { ok: false, drop,
             why: `a ${drop ?? 'unmeasured'}-block drop is not survivable at ${bot.health} hp` }
  }

  seizeBody(bot, 'underfoot')
  const tool = bestTool(bot, target)
  if (tool) await bot.equip(tool, 'hand').catch(() => {})
  const yBefore = pos.y
  try { await digBounded(bot, target, budgetMs) } catch (e) {
    return { ok: false, drop, why: `dig failed: ${e.message}` }
  }
  // POSTCONDITION, not "I ran it". The same discipline the entombed branch uses:
  // the claim that matters is that the bot is lower, not that a dig was issued.
  const fell = yBefore - (bot.entity?.position?.y ?? yBefore)
  return { ok: fell >= 0.5, drop, fell,
           why: fell >= 0.5 ? `descended ${fell.toFixed(1)}` : 'dug but did not descend' }
}

const HARVEST_OFFSETS = [
  [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1],
  [1, 1, 0], [-1, 1, 0], [0, 1, 1], [0, 1, -1],
  [1, -1, 0], [-1, -1, 0], [0, -1, 1], [0, -1, -1],
]

// Four is enough to pillar clear of most pits, but the number that actually
// matters is ONE: `haveBlocks` is a .some() test, so a single placeable block
// flips the next maroon check from need_scaffold to climb.
export const SCAFFOLD_SELF_SOURCE = 4

/**
 * SOURCE SCAFFOLD FROM THE WALL THE BOT IS ALREADY TOUCHING.
 *
 * The prerequisite mechanism assumes a bot can go and fetch what it lacks. A
 * marooned bot cannot -- having no route IS the definition of marooned -- so the
 * two mechanisms contradicted each other, and the telemetry says so plainly:
 * over 24 hours, 453 of 479 adopted prerequisites expired at the 15-minute TTL,
 * and every sampled detail read `dirt-class: had 0/8`. Not partial progress.
 * ZERO. The fleet spent hours asking bots to travel for blocks they were
 * standing inside.
 *
 * Digging a neighbour needs no pathfinder, no goal and no route, which makes it
 * the one acquisition a trapped bot can always attempt.
 *
 * Two rules stop this from making things worse:
 *   - ONLY BLOCKS WORTH HAVING. Breaking stone bare-handed drops nothing --
 *     pillarOut documents the same trap -- so a dig that yields no item merely
 *     widens the pit. A candidate must DROP something placeable (see
 *     scaffoldCandidate -- the block itself need not be placeable, and several
 *     placeable-looking ones drop items) *and* be harvestable with what the bot
 *     can actually hold.
 *   - BOUNDED, ALWAYS. An unbounded dig inside a rescue strands the bot for
 *     good, because for a marooned bot nothing else is coming.
 */
export async function harvestAdjacent(bot, want = SCAFFOLD_SELF_SOURCE, budgetMs = 20_000) {
  const held = () => bot.inventory.items()
    .filter(it => PLACEABLE.test(it.name))
    .reduce((n, it) => n + it.count, 0)
  const had = held()
  if (had >= want) return { gained: 0, dug: 0, had, skipped: 'already holds enough' }

  // Same contention as every other rescue: the pathfinder rewrites controls each
  // tick and a dig under a body being steered elsewhere never completes.
  seizeBody(bot, 'harvest')
  const deadline = Date.now() + budgetMs
  let dug = 0, tried = 0, unsafe = 0

  for (const [dx, dy, dz] of HARVEST_OFFSETS) {
    if (held() >= want || Date.now() > deadline) break
    const b = bot.blockAt(bot.entity.position.offset(dx, dy, dz))
    // scaffoldCandidate, NOT PLACEABLE: the question here is "is this worth
    // digging?", which is answered by what the block DROPS. See the comment on
    // scaffoldCandidate for the five blocks whose drops disqualify them.
    if (!b || b.boundingBox !== 'block' || !scaffoldCandidate(b.name, bot.registry)) continue
    // BELOW-LEVEL OFFSETS ONLY, and the scoping is the safety property.
    //
    // The eight foot- and head-level offsets have shipped for weeks and are not
    // in this patch's remit; putting a guard on them would change behaviour
    // nobody asked to change, and an over-strict guard on the pillar path is
    // exactly how 561 of 566 attempts got refused once already. The four
    // diagonal-down cells are new, and they are the only ones that OPEN a cell
    // beside the bot's feet, so they are the only ones that need the check.
    if (dy < 0) {
      const risk = harvestSafe({
        at: (a, c, d) => bot.blockAt(bot.entity.position.offset(a, c, d)), dx, dy, dz,
      })
      if (risk) {
        // NOT counted as `tried`. That counter's whole value is that it
        // separates "not in the vocabulary" from "in the vocabulary and
        // refused for a tool" -- the split this entire fix was diagnosed from.
        // A safety refusal is a third thing and gets its own number rather than
        // contaminating either.
        unsafe++
        log('warn', 'reflex: refusing a below-level harvest', { at: `${dx},${dy},${dz}`, risk })
        continue
      }
    }
    tried++
    // SILK TOUCH IS A KNOWN, ACCEPTED HOLE, recorded rather than guarded.
    //
    // `scaffoldCandidate` reasons about the UNENCHANTED drop, so a Silk Touch
    // tool would make grass_block drop grass -- not placeable -- and this dig
    // would yield nothing usable. Three things make that not worth a branch:
    // `bestTool` ranks on digTime and knows nothing about enchantments, so it
    // would not select for it; `gained` is an inventory delta, so the routine
    // reports the failure honestly rather than claiming a success; and this
    // fleet has never smelted an ingot, let alone enchanted a tool. Preferring
    // an empty hand for hand-harvestable candidates would also cost the case
    // that works today -- a bot WITH a pickaxe taking stone.
    const tool = bestTool(bot, b)
    if (tool) await bot.equip(tool, 'hand').catch(() => {})
    // Bare-handed stone yields nothing; skip rather than pay the dig for free.
    if (b.canHarvest && !b.canHarvest(bot.heldItem?.type ?? null)) continue
    try { await digBounded(bot, b, 6000) } catch { continue }
    dug++
    await sleep(400)   // the drop must reach the bot before the next count
  }
  return { gained: held() - had, dug, tried, unsafe, had }
}

// --------------------------------------------------------- escape ramp -----

/**
 * The four cardinals in PREFERENCE order for a bot at this yaw: the way it is
 * already pointed, then the two ninety-degree turns, then the reverse.
 *
 * WHICH WAY IS YAW ZERO IS NOT A MATTER OF TASTE HERE, because this routine
 * both READS a yaw and WRITES one. It ranks bearings from `bot.entity.yaw`, and
 * a hundred lines below it turns the bot with mineflayer's own conversion,
 * `bot.look(atan2(-x, -z))`. Those two must be inverses or the list is a lie:
 * `atan2(-x, -z) === 0` solves to `z = -1`, so yaw 0 is NORTH, and the array
 * below is indexed from north. The invariant is pinned by behaviour in
 * escape-stair.test.mjs -- for every quadrant, `atan2` of the first bearing
 * must round-trip back to that quadrant -- rather than by agreeing with another
 * module, which is what it used to do.
 *
 * IT USED TO BE INDEXED FROM SOUTH, copied from `stairBearings` in skills.mjs
 * to keep the two rescues in step. The copy was faithful and the original is
 * off by two: `stairBearings` says in its own comment that "yaw is 0 at south",
 * and mineflayer's `atan2(-dx, -dz)` says otherwise. The consequence there is
 * only that `mine` prefers to cut its descent behind itself, because nothing in
 * that path converts a bearing back into a look -- so it is a preference bug
 * and stays out of this patch. HERE the consequence was a bot turning a hundred
 * and eighty degrees on every tie, which is the opposite of the property the
 * comment claimed. The cross-check against skills.mjs is gone with it: two
 * modules agreeing is not evidence either is right.
 */
const ESCAPE_CARDINALS = [{ x: 0, z: -1 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 1, z: 0 }]

export function escapeBearings (yaw = 0) {
  const q = ((Math.round((yaw || 0) / (Math.PI / 2)) % 4) + 4) % 4
  return [q, (q + 1) % 4, (q + 3) % 4, (q + 2) % 4].map(i => ESCAPE_CARDINALS[i])
}

/** How far ahead the bearing chooser looks. Four steps is one small cavern. */
export const ESCAPE_STAIR_LOOKAHEAD = 4

/**
 * How many steps one firing may cut. Bounded for the reason every rescue here
 * is bounded -- for a marooned bot nothing else is coming, so a routine that
 * runs long is a routine that has replaced the bot's whole life.
 *
 * SIX IS NOT A DISTANCE, IT IS A CHECKPOINT. Unlike a pillar, a ramp is not
 * all-or-nothing: every step is a permanent, walkable improvement carved into
 * the world, and the next firing resumes from the top of what the last one cut.
 * `canFinishClimb` exists because a half-finished pillar is strictly worse than
 * no pillar; a half-finished ramp is strictly better than no ramp, which is why
 * this routine may start one it cannot finish and `pillarOut` may not.
 */
export const ESCAPE_STAIR_MAX_STEPS = 6

/**
 * CUT A RAMP AND WALK UP IT, USING NOTHING.
 *
 * The remedy for the 71.4%. See `stairUpStep` in scaffold.mjs for the geometry
 * and the safety argument; this is only the body that executes it.
 *
 * THE HANDS STAY EMPTY ON PURPOSE, and it is the reason this routine does not
 * need an exemption from `mayDigForEscape`. That guard exists to stop an escape
 * spending its last pickaxe, and it is right. A ramp never equips one, so the
 * invariant it protects is preserved by construction rather than waived -- the
 * bot ends the climb holding exactly the tools it started with. It also costs
 * nothing to honour: the blocks in the way drop nothing to a bare hand either
 * way, so there was never a tool worth swinging.
 *
 * WHAT COUNTS AS DONE IS A ROUTE, NOT A HEIGHT. `pillarOut` already paid for
 * the other answer -- Miner01 at the bottom of its own forty-block shaft with
 * its head clear, "escaping" one block per invocation for ninety minutes. The
 * condition the trap denies is that a journey can start, so that is the
 * condition that ends this, and height gained is progress rather than success.
 *
 * @returns {{steps, climbed, stopped, bearing, runway, breached, yielded}}
 *          `yielded` names the reflex that took the body, and is the one exit
 *          on which the controls are deliberately left alone.
 */
export async function escapeStairUp (bot, {
  maxSteps = ESCAPE_STAIR_MAX_STEPS,
  depth = ESCAPE_STAIR_LOOKAHEAD,
  budgetMs = 60_000,
  yieldTo = () => null,
} = {}) {
  const startY = bot.entity.position.y
  const deadline = Date.now() + budgetMs
  // ASK BEFORE TAKING. `seizeBody` clears every control state, so checking the
  // yield only inside the loop would still wipe the owner's stroke on the way
  // in -- the one call this routine makes before it has looked at anything.
  const owner0 = yieldTo()
  if (owner0) {
    return { steps: 0, climbed: 0, stopped: `yielded the body to ${owner0}`,
             bearing: null, runway: 0, breached: 0, yielded: owner0 }
  }
  // The pathfinder rewrites controls every tick, and a dig under a body being
  // steered elsewhere never completes. Same contention as every other rescue.
  seizeBody(bot, 'escape-stair')

  // Bedrock and obsidian are refused by the registry's own numbers. `planDig`
  // caps a bare-handed dig at 30s, which passes stone (7.5s), deepslate (15s)
  // and cobbled_deepslate (17.5s) and rejects obsidian (250s) -- the same
  // distinction `shaftAscend` already draws, from the same function, so a block
  // this ramp will attempt is exactly a block that climb would attempt.
  const canBreak = b => {
    if (b?.diggable === false) return false
    return !planDig(predictedDigMs(b, null)).refuse
  }

  let steps = 0
  let stopped = null
  let bearing = null
  let runway = 0
  let breached = 0
  let yielded = null

  // WHOEVER OWNS THE BODY, IT IS NOT THIS. `yieldTo` returns a reason when a
  // reflex with a stronger claim has taken the controls -- in practice the
  // drowning rescue, which `seizeBody`s and then re-asserts a stroke every
  // tick while this loop is awaiting.
  //
  // THIS YIELDS RATHER THAN CLAIMING, and the direction is the whole point.
  // `runner.claimBody` cannot help here: it returns a dead handle when the
  // runner is idle, and this runs immediately after `runner.interrupt`, so the
  // claim a reflex could take is the one that is never granted. Standing the
  // water rescue down for a climb is the other direction, and it is the change
  // that multiplied drownings 7.5x on 2026-08-29 (canary 4a1dfcb, p = 0.0079).
  // A ramp can be resumed from the step it stopped on. A drowning bot cannot.
  //
  // Releasing is done by NOT touching the controls: the owner has already set
  // the stroke it wants, and `clearControlStates()` on the way out is exactly
  // the wipe this is here to prevent.
  const finish = () => {
    if (!yielded) bot.clearControlStates()
    return {
      steps,
      climbed: bot.entity.position.y - startY,
      stopped: stopped ?? 'step budget spent',
      bearing,
      runway,
      breached,
      yielded,
    }
  }

  /** Dig one block inside the remaining budget, so no swing can outlive it. */
  const digWithin = async (b) => {
    const budget = planDig(predictedDigMs(b, null))
    if (budget.refuse) return `cannot clear ${b.name} by hand`
    const left = deadline - Date.now()
    if (left <= 0) return 'budget spent'
    try { await digBounded(bot, b, Math.min(budget.budgetMs, left)) } catch (e) {
      return `dig failed on ${b.name}: ${e.message}`
    }
    return null
  }

  // TAKE THE CEILING FIRST, OR THE RAMP CANNOT HAVE A FIRST STEP.
  //
  // `stairUpStep` asks for `at(0,2,0)` to be passable and `isEntombed` is
  // DEFINED by that cell being solid, so without this the ramp answers every
  // entombed bot with `no headroom to climb` on all four cardinals -- the exact
  // shape of the four traps already written down here, two correct guards
  // meeting where the bot has no legal move. Verified against the built tree,
  // not reasoned about: a 1x1 stone pocket scored `runway: 0` before and
  // `runway: 4` after this single cell came out.
  //
  // A no-op wherever the column is already open, which is every caller the ramp
  // had before this line: `headroomBreach` returns an empty dig list rather
  // than a refusal, so the maroon branch runs exactly as it did.
  //
  // A LOOP, NOT A SWING, AND THAT IS THE GRAVEL FIX. `headroomBreach` hands
  // back ONE cell at a time, highest first, and refuses to reach the ceiling
  // while a falling block rests on it. Re-planning after every swing is what
  // makes a gravel column of any depth safe: each iteration takes the block at
  // (0,3,0) while the ceiling still holds the rest of the column up, waits for
  // the next one to land there, and only opens the ceiling once nothing is
  // left to fall through it. Bounded, because a sand column can be sixty deep
  // and this is a rescue, not a quarry.
  for (let swing = 0; swing <= BREACH_MAX_SWINGS; swing++) {
    if ((yielded = yieldTo())) { stopped = `yielded the body to ${yielded}`; return finish() }
    if (Date.now() > deadline) { stopped = 'budget spent breaching the ceiling'; return finish() }
    if (swing === BREACH_MAX_SWINGS) {
      stopped = `a falling column overhead outlasted ${BREACH_MAX_SWINGS} swings`
      return finish()
    }
    const p = bot.entity.position
    const at = (dx, dy, dz) => bot.blockAt(p.offset(dx, dy, dz))
    const plan = headroomBreach({ at, canBreak })
    if (!plan.ok) { stopped = plan.reason; return finish() }
    if (!plan.dig.length) break                       // ceiling open and stable

    // BARE HANDS, HERE TOO. The ramp's whole exemption from `mayDigForEscape`
    // is that it never equips a tool, so the invariant that guard protects is
    // preserved by construction rather than waived. Breaking the ceiling by
    // hand keeps that true of the first swing as well as the rest.
    if (bot.heldItem) await bot.unequip('hand').catch(() => {})
    const [dx, dy, dz] = plan.dig[0]
    const b = bot.blockAt(p.offset(dx, dy, dz))
    if (!b) { stopped = 'terrain not loaded'; return finish() }
    const failed = await digWithin(b)
    if (failed) { stopped = `ceiling ${failed}`; return finish() }
    if (dy === 2) breached++
    // HALF A SECOND, NOT A FIFTH OF ONE. Falling-block gravity is 0.04
    // blocks/tick^2, so one block is ~7 ticks -- about 350ms -- before the spawn
    // tick and the round trip to the server are counted. `shaftAscend` has used
    // 500ms for exactly this cell since before the ramp existed, and 200ms was
    // a sample that could not have SEEN the thing it was sampling for.
    await sleep(FALLING_SETTLE_MS)
  }

  // AND CHECK THAT THE CEILING DID NOT LAND ON YOU.
  //
  // Prevention above is the real fix; this is the admission that a rescue must
  // survive being wrong. If a column did come down -- a chunk loaded late, a
  // block the registry does not call falling, a sand block pushed in by a
  // piston -- the bot is standing INSIDE it and losing 1 HP every half second.
  // Digging its own cells out is a remedy it can perform from where it is,
  // bare-handed, in under a second per block, and it is the only one.
  {
    const unburied = await unburySelf(bot, { deadline, digWithin })
    if (unburied.stopped) { stopped = unburied.stopped; return finish() }
  }

  for (; steps < maxSteps; steps++) {
    if ((yielded = yieldTo())) { stopped = `yielded the body to ${yielded}`; return finish() }
    if (Date.now() > deadline) { stopped = 'budget spent'; break }
    const p = bot.entity.position
    const at = (dx, dy, dz) => bot.blockAt(p.offset(dx, dy, dz))

    const choice = chooseStairUpBearing({
      at, bearings: escapeBearings(bot.entity.yaw), depth, canBreak,
    })
    if (!choice || choice.runway === 0) {
      // Every cardinal refused its FIRST step. Ask the chosen one for its
      // reason rather than reporting a bare zero: "no tread to stand on" and
      // "lava against the step" are different worlds, and a rescue that cannot
      // tell them apart is the instrument this project keeps being burned by.
      const bear = choice?.bear ?? escapeBearings(bot.entity.yaw)[0]
      stopped = stairUpStep({ at, bear, canBreak }).reason ?? 'no bearing runs'
      break
    }
    bearing = choice.bear
    runway = choice.runway

    const plan = stairUpStep({ at, bear: bearing, canBreak })
    if (!plan.ok) { stopped = plan.reason; break }

    // EMPTY THE HAND BEFORE THE FIRST SWING, not per block: `unequip` is a
    // server round trip and the durability that matters is spent on the dig.
    if (bot.heldItem) await bot.unequip('hand').catch(() => {})

    let blocked = null
    for (const [dx, dy, dz] of plan.dig) {
      // THE DEADLINE IS CHECKED BETWEEN DIGS, NOT ONLY BETWEEN STEPS.
      //
      // A step is up to three bare-handed swings and deepslate is 15s each, so
      // a per-step check alone lets one step overrun the whole budget by a
      // minute while holding the body. Stopping mid-step costs nothing that
      // matters -- the cells already cleared stay cleared, and the next firing
      // re-plans from the same cell and finishes them.
      if (Date.now() > deadline) { blocked = 'budget spent mid-step'; break }
      const b = bot.blockAt(p.offset(dx, dy, dz))
      if (!b) { blocked = 'terrain not loaded'; break }
      const failed = await digWithin(b)
      if (failed) { blocked = failed; break }
    }
    if (blocked) { stopped = blocked; break }

    // GRAVEL LANDS IN THE HOLE YOU JUST MADE. Digging the headroom first makes
    // that the common case rather than the deadly one, but it still has to be
    // SEEN before the bot walks in: stepping under a settling column is how a
    // suffocation gets filed as a mystery.
    //
    // A BOUNDED RE-CLEAR, AND ITS FAILURES ARE READ. The first version swallowed
    // every dig error under a comment claiming they were "verified below", and
    // nothing below verified anything -- the only downstream check is a y-gain
    // test that stops the ramp, so a cell that refused to clear arrived as a
    // mysterious refusal to climb. Now a failed re-clear ends the step and says
    // which block would not move.
    let refilledStop = null
    for (let recut = 0; recut < REFILL_MAX_RECUTS; recut++) {
      await sleep(FALLING_SETTLE_MS)
      const again = stairUpStep({ at, bear: bearing, canBreak })
      if (!again.ok) { refilledStop = `the step closed behind the dig: ${again.reason}`; break }
      if (!again.dig.length) break
      if (recut === REFILL_MAX_RECUTS - 1) {
        refilledStop = 'a falling column kept refilling the step'
        break
      }
      for (const [dx, dy, dz] of again.dig) {
        const b = bot.blockAt(p.offset(dx, dy, dz))
        if (!b) { refilledStop = 'terrain not loaded'; break }
        const failed = await digWithin(b)
        if (failed) { refilledStop = `re-clearing the step: ${failed}`; break }
      }
      if (refilledStop) break
    }
    if (refilledStop) { stopped = refilledStop; break }

    // TAKE THE STEP. Hand-rolled rather than handed to the pathfinder: this
    // bot is marooned by definition -- `canStartAPath` is false, which is why
    // the reflex is here at all -- and asking a planner that has already said
    // NO ROUTE to walk one block is how a rescue inherits someone else's
    // refusal. Look, hold forward, jump, release.
    const before = bot.entity.position.clone()
    await bot.look(Math.atan2(-bearing.x, -bearing.z), 0, true).catch(() => {})
    bot.setControlState('forward', true)
    bot.setControlState('jump', true)
    await sleep(450)
    bot.setControlState('jump', false)
    await sleep(350)
    if ((yielded = yieldTo())) { stopped = `yielded the body to ${yielded}`; return finish() }
    bot.clearControlStates()
    // LET IT LAND BEFORE MEASURING. `mine` rejected five of six SUCCESSFUL
    // steps by reading a raw y while the bot was still falling over the lip;
    // the fix there was a settle and a floored comparison, and it is the same
    // fix here.
    await sleep(250)

    if (bot.entity.position.y - before.y < 0.5) {
      // DUG A STEP AND DID NOT TAKE IT. Stop rather than cut another: the
      // failure to avoid is carving a widened ledge while every log line says
      // the climb is progressing, which `mine` did for twenty-three days.
      stopped = `cut a step at y=${Math.round(before.y)} but could not stand in it`
      break
    }

    if (await canStartAPath(bot)) {
      steps++
      stopped = 'a route exists again'
      break
    }
  }

  return finish()
}

/**
 * HOW LONG A FALLING COLUMN NEEDS BEFORE THE WORLD CAN BE READ AGAIN.
 *
 * Falling-block gravity is 0.04 blocks/tick^2, so a one-block drop is about
 * seven ticks -- ~350ms -- and that is before the spawn tick, the landing tick
 * and the round trip to the server. The patch this replaces sampled at 200ms,
 * which is an instrument that could not have seen the event it was sampling
 * for. `shaftAscend` (skills.mjs) has used 500ms for the same cell since long
 * before the escape ramp existed; this is that number, named once.
 */
export const FALLING_SETTLE_MS = 500

/** How many times the ceiling breach may re-plan against a settling column. */
export const BREACH_MAX_SWINGS = 6

/** How many times one stair step may be re-cut after a refill. */
export const REFILL_MAX_RECUTS = 3

/**
 * DIG YOURSELF OUT OF THE BLOCK THAT LANDED ON YOU.
 *
 * The last line of defence, and it exists because prevention has to be allowed
 * to be wrong. A falling-block entity passes through a bot and lands on the
 * first SOLID cell beneath it, which for a bot on a floor is its own feet cell,
 * so a column released overhead fills (0,0,0), (0,1,0) and (0,2,0) and the bot
 * suffocates at 1 HP per half second -- about ten seconds, inside a routine
 * that may hold the body for a minute.
 *
 * TOP DOWN, so the swing that frees the head is not immediately refilled by the
 * cell above it. Only FALLING blocks are taken: a bot whose head cell is stone
 * has not been buried by this routine, it has walked somewhere strange, and
 * digging blindly around a body is how a rescue becomes an excavation.
 *
 * Returns `{ dug, stopped }`. `stopped` is non-null only when the bot is still
 * buried afterwards, because that is the one outcome the caller must not treat
 * as a ramp it can go on climbing.
 */
export async function unburySelf (bot, { deadline = Infinity, digWithin } = {}) {
  let dug = 0
  const buried = () => {
    const p = bot.entity.position
    for (const dy of [2, 1, 0]) {
      const b = bot.blockAt(p.offset(0, dy, 0))
      if (b && isFallingBlock(b) && !bodyPassable(b)) return { b, dy }
    }
    return null
  }
  for (let i = 0; i < 4; i++) {
    const hit = buried()
    if (!hit) return { dug, stopped: null }
    if (Date.now() > deadline) break
    if (bot.heldItem) await bot.unequip('hand').catch(() => {})
    const failed = await digWithin(hit.b)
    if (failed) return { dug, stopped: `buried in ${hit.b.name} and ${failed}` }
    dug++
    await sleep(FALLING_SETTLE_MS)
  }
  const still = buried()
  return { dug,
           stopped: still ? `buried in ${still.b.name} at feet+${still.dy} and could not dig out`
                          : null }
}

/**
 * IS THIS THE SAME TRAP, OR A DIFFERENT ONE FOUR COUNTIES AWAY?
 *
 * `climbRefusals` escalates a backoff and, now, gates a rescue that digs. Both
 * are meant for a bot that is stuck HERE, and neither survives the counter
 * being a lifetime total -- which it was, because the reset only ever ran on
 * the tick that a refusal did NOT happen, and a bot that walks away from a
 * momentary tomb never runs that tick at all.
 *
 * That matters because the detector is not clean. Measured over 8h on 80 bots
 * (2,309 entombed events, positive control 369,850 events / 14 of 14 sampled
 * bots seen travelling >50 blocks), 21.0% of firings at y=60-79 came from bots
 * that were in motion both two minutes BEFORE and two minutes AFTER -- a bot
 * walking through a cave mouth or an overhang, not a bot sealed in. Four of
 * those spread across an afternoon used to add up to the same "4" as four in a
 * row in a stone pocket, and would now buy a ramp cut in open terrain.
 *
 * So the streak is scoped to a place. Two blocks of tolerance, because a bot
 * being interrupted mid-step drifts a fraction of a block and that is the same
 * trap; anything further is a different hole and starts again at one.
 *
 * @returns the streak this refusal continues -- 1 when it starts a new one.
 */
/**
 * WAS THIS RAMP ATTEMPT A SUCCESS OR A FAILURE?
 *
 * One line, and it is exported and shared by both call sites for one reason:
 * the first version of this patch logged `*_ramp_cut` ONLY when the ramp cut
 * something, and folded every refusal into `_entombed_needs_blocks` /
 * `_marooned_needs_scaffold`. That makes the ramp's success rate 100% by
 * construction and leaves its denominator recoverable only by string-parsing
 * `stopped` out of a different label's `detail`. CLAUDE.md names this shape --
 * a metric that conditions on attempts -- and the fleet has paid for it once
 * already, when escape rate rose while deaths tripled.
 *
 * With one kind carrying both outcomes, `success / (success + failed)` is a
 * rate about something, and `steps=` on the detail gives the size as well as
 * the sign. Extracted rather than inlined so that a test can prove the failing
 * arm is REACHABLE, which is the thing a text assertion cannot say.
 */
export function rampStatus (ramp) {
  return ramp && ramp.steps > 0 ? 'success' : 'failed'
}

/**
 * WHAT A REFUSAL BUYS: A RAMP, A BACKOFF, BOTH, OR NEITHER.
 *
 * The two counters this reads answer different questions and the patch that
 * introduced them let one silently delete the other.
 *
 *   `refusals` is a LIFETIME total. It drives the escalating backoff and the
 *   prerequisite ask, and it must keep counting for a bot that moves -- those
 *   are the firings that need a backoff most, because nothing about them is
 *   going to resolve on its own.
 *
 *   `streak` is scoped to a PLACE (see `refusalStreak`). It gates only the
 *   ramp, because the ramp DIGS: 21.0% of entombed firings at y=60-79 came
 *   from bots in motion on both sides of the event, and four of those spread
 *   across an afternoon must not buy a bare-handed excavation in open terrain.
 *
 * The bug this replaces used the scoped streak for both. For a moving bot the
 * streak is 1 every time, so `% every === 0` was never true, so the ask, the
 * telemetry AND the backoff were unreachable -- while the branch still fired
 * every ESCAPE_MIN_INTERVAL_MS and still interrupted the running skill. An
 * interrupt every fifteen seconds, forever, with no record of it.
 *
 * @returns {{due: boolean, ramp: boolean, backoffMs: number}}
 */
export function refusalEscalation ({ refusals = 0, streak = 0,
                                     every = ESCAPE_GIVE_UP_AFTER,
                                     capMs = 10 * 60_000 } = {}) {
  const due = refusals > 0 && refusals % every === 0
  return {
    due,
    ramp: due && streak >= every,
    backoffMs: Math.min((refusals / every) * 60_000, capMs),
  }
}

export function refusalStreak (streak = 0, prevPos = null, nowPos = null, tol = 2) {
  if (!prevPos || !nowPos) return 1
  const dx = (nowPos.x ?? 0) - (prevPos.x ?? 0)
  const dy = (nowPos.y ?? 0) - (prevPos.y ?? 0)
  const dz = (nowPos.z ?? 0) - (prevPos.z ?? 0)
  // Y COUNTS. A bot that gained eight blocks is being refused by a new ceiling,
  // and calling that a continuation would escalate a backoff against a rescue
  // that is working -- the shape `pillarOut` already paid for once, one block
  // per invocation for ninety minutes with every log line reading "escaping".
  if (Math.sqrt(dx * dx + dy * dy + dz * dz) > tol) return 1
  return (streak > 0 ? streak : 0) + 1
}

const PILLAR_MAX_BLOCKS = 24

/**
 * WHAT A DECLINED CLIMB IS ACTUALLY SHORT OF.
 *
 * `pillarOut` declines for two different reasons and used to answer both with a
 * bare `false`. Two of its four return paths run through `digStraightUp`, which
 * refuses when `mayDigForEscape` says there is no pickaxe to spare -- and that
 * is the dominant shape underground, where 28 of 32 frozen bots held zero
 * pickaxes. Answering it with "gather blocks" sends a bot that is short a TOOL
 * to go and fetch gravel.
 *
 * The block count is derived, not chosen. `canFinishClimb` demands
 * `need + 1 + (headroomBlocked ? 1 : 0)`, and entombment implies a blocked
 * ceiling, so a 24-block pillar needs 26. Asking for fewer clears the
 * prerequisite as SATISFIED while the climb still refuses -- the bot then sits
 * entombed forever with exactly as many blocks as it was told to fetch, and the
 * telemetry says the goal layer was asked. A closed livelock.
 */
export function climbPrereqFor (reason, maxBlocks = PILLAR_MAX_BLOCKS) {
  if (reason === 'needs_pickaxe') {
    return { items: ['wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'diamond_pickaxe'],
             count: 1,
             describe: 'Get a pickaxe. You are sealed in and cannot break the ceiling without one.' }
  }
  if (reason === 'needs_blocks') {
    const count = maxBlocks + 2
    return { items: ['dirt', 'cobblestone', 'stone', 'andesite', 'diorite',
                     'granite', 'gravel', 'sand', 'netherrack'],
             count,
             describe: `Gather ${count} blocks. You are sealed in and cannot pillar out without them.` }
  }
  return null
}

async function pillarOut(bot, maxBlocks = PILLAR_MAX_BLOCKS) {
  // ALL OR NOTHING. See canFinishClimb: a climb that runs out partway is how
  // this fleet manufactures permanent traps.
  {
    const have = bot.inventory.items()
      .filter(it => PLACEABLE.test(it.name))
      .reduce((a, it) => a + it.count, 0)
    const head = bot.blockAt(bot.entity.position.offset(0, 2, 0))
    if (!canFinishClimb({ have, need: maxBlocks,
                          headroomBlocked: !!head && head.name !== 'air' })) {
      logEvent({ kind: 'maroon_climb_refused', status: 'failed',
                 detail: `will not start a ${maxBlocks}-block climb with ${have} ` +
                         `placeable block(s): running out partway seals the bot ` +
                         `higher than it started, holding nothing`,
                 snapshot: snapshot(bot) })
      return 'needs_blocks'
    }
  }
  // Same contention as the drowning rescue: pathfinder rewrites jump every
  // tick while a goal is set, so a pillar that does not own the body places
  // blocks under a bot that is being steered somewhere else.
  seizeBody(bot, 'pillar')

  const startY = bot.entity.position.y
  let stalled = 0

  for (let i = 0; i < maxBlocks; i++) {
    const yBefore = bot.entity.position.y

    // Headroom first. Breaking stone bare-handed drops nothing, but for escape
    // purposes breaking is all that matters.
    const head = bot.blockAt(bot.entity.position.offset(0, 2, 0))
    if (head && head.name !== 'air' && head.name !== 'water') {
      // Bounded: an escape routine that hangs on a dig strands the bot for
      // good, because nothing else is coming.
      const tool = bestTool(bot, head)
      if (tool) await bot.equip(tool, 'hand').catch(() => {})
      try { await digBounded(bot, head) } catch { /* may be unreachable; try anyway */ }
      await sleep(150)
    }

    const item = bot.inventory.items().find(it => PLACEABLE.test(it.name))
    if (!item) {
      // OUT OF BLOCKS MID-CLIMB. Do NOT fall through to digging up: that is the
      // path that spends the last pickaxe and finishes the seal. Stop here and
      // say so; the bot is worse off than when it started and something else
      // must decide what happens next.
      logEvent({ kind: 'maroon_climb_exhausted', status: 'failed',
                 detail: `ran out of placeable blocks ${i} block(s) into a ` +
                         `${maxBlocks}-block climb at y=${Math.round(bot.entity.position.y)}`,
                 snapshot: snapshot(bot) })
      return 'exhausted'
    }

    await bot.equip(item, 'hand').catch(() => {})
    const below = bot.blockAt(bot.entity.position.offset(0, -1, 0))
    if (!below) break
    bot.setControlState('jump', true)
    await sleep(300)
    try { await bot.placeBlock(below, new Vec3(0, 1, 0)) } catch { /* mistimed */ }
    bot.setControlState('jump', false)
    await sleep(250)

    if (bot.entity.position.y - yBefore < 0.5) {
      if (++stalled >= 3) {
        log('warn', 'reflex: pillaring is not gaining height, digging up instead')
        return digStraightUp(bot, startY)
      }
    } else {
      stalled = 0
    }

    // WHEN IS THE ESCAPE OVER?
    //
    // This used to be `if (!isEntombed(bot)) break` -- and isEntombed() means
    // "head blocked". Miner01 was at the bottom of a forty-block open shaft it
    // had dug itself, so its head was NEVER blocked: the loop placed exactly one
    // block and exited, every time it ran. Two invocations, two blocks, ninety
    // minutes at the bottom of the hole with 70 cobblestone in its pockets.
    //
    // "My head is clear" was only ever a proxy for "I can leave". Ask the real
    // question instead: can a journey START from where I now stand? That is the
    // condition the bot actually needs restored, it is what the trap denies, and
    // canStartAPath() already answers it. Height gained is progress, not success.
    //
    // Checked every third block because it runs a real (short-budget) search and
    // this is a reflex; a rescue that stalls for seconds deciding whether it has
    // finished is its own failure.
    if (i % 3 === 2 && await canStartAPath(bot)) {
      log('info', 'reflex: pillared until a route exists again',
          { from: Math.round(startY), to: Math.round(bot.entity.position.y), blocks: i + 1 })
      return
    }
  }

  const gained = bot.entity.position.y - startY
  if (gained < 1) {
    log('error', 'reflex: pillar out FAILED, no height gained', { y: Math.round(startY) })
    return digStraightUp(bot, startY)
  }
  // Ran out of budget with height gained but no route: say so plainly rather
  // than reporting the height as though it were the point.
  log(await canStartAPath(bot) ? 'info' : 'warn',
      'reflex: pillaring ended', {
        from: Math.round(startY), to: Math.round(bot.entity.position.y),
        routeRestored: await canStartAPath(bot),
      })
}

/** Break upward until there is open sky, then
 step out. */
/**
 * bot.dig() with a bound, for the RESCUE path.
 *
 * bot.dig resolves when the server confirms the break and waits forever when
 * that never comes -- the block changed under us, the chunk unloaded, another
 * bot took it. An unbounded dig inside an escape routine means the escape
 * itself hangs, which is the worst possible place for it: the bot is already
 * stuck, and now nothing will ever try again.
 *
 * This is the same defect that cost the fleet 48 OOM kills today through
 * collectblock's unbounded waits. It was sitting in the rescue the whole time.
 */
async function digBounded(bot, block, ms = 8000) {
  let t
  try {
    await Promise.race([
      bot.dig(block),
      new Promise((_, rej) => { t = setTimeout(() => {
        try { bot.stopDigging?.() } catch { /* not digging */ }
        rej(new Error(`dig exceeded ${ms}ms`))
      }, ms) }),
    ])
  } finally { clearTimeout(t) }
}

async function digStraightUp(bot, startY, maxSteps = 20) {
  // THE ESCAPE MAY NOT SPEND THE EXIT. 574 escape events destroyed a pickaxe,
  // and 24 of 26 permanently-stuck bots now hold none -- at which point
  // harvestAdjacent fails 99.4% of the time with "0/8 dug", because the walls
  // are stone and nothing is left to break them with.
  const blocking = bot.blockAt?.(bot.entity.position.offset(0, 2, 0))
  if (!mayDigForEscape(bot.inventory?.items?.() ?? [], blocking)) {
    logEvent({ kind: 'maroon_dig_refused', status: 'failed',
               detail: `will not dig out on the last pickaxe: ${blocking?.name ?? 'the ceiling'} ` +
                       'needs a tool, and breaking it here ends every future ' +
                       'escape this bot could make',
               snapshot: snapshot(bot) })
    return 'needs_pickaxe'
  }
  for (let i = 0; i < maxSteps; i++) {
    const above = bot.blockAt(bot.entity.position.offset(0, 2, 0))
    if (!above || above.name === 'air') {
      // Ceiling clear -- try to gain the block, otherwise walk toward the gap.
      const item = bot.inventory.items().find(it => PLACEABLE.test(it.name))
      if (item) {
        await bot.equip(item, 'hand').catch(() => {})
        const below = bot.blockAt(bot.entity.position.offset(0, -1, 0))
        bot.setControlState('jump', true)
        await sleep(300)
        try { await bot.placeBlock(below, new Vec3(0, 1, 0)) } catch {}
        bot.setControlState('jump', false)
        await sleep(200)
      } else {
        // No blocks: head for whichever side is open and walk out.
        await walkToOpening(bot)
        return
      }
    } else {
      const tool = bestTool(bot, above)
      if (tool) await bot.equip(tool, 'hand').catch(() => {})
      try { await digBounded(bot, above) } catch { break }
      await sleep(150)
    }
    // THE SAME MISTAKE pillarOut ALREADY FIXED, LEFT IN ITS SIBLING.
    //
    // This was `if (!isEntombed(bot)) break`, and isEntombed() means "head
    // blocked". The comment forty lines above records what that cost the first
    // time: Miner01 at the bottom of a forty-block open shaft, head never
    // blocked, one block placed per invocation, ninety minutes down there. The
    // fix was applied to pillarOut and not to the fallback that runs WHEN
    // PILLARING FAILS -- which is precisely the case for a bot in an open
    // cavern, the only case this function exists to handle.
    //
    // 2026-08-10: 63 `marooned` events in thirty minutes, bots sitting at
    // y=-45, -42, -42, -2 the whole time, _path_noPath 431 times. Detection was
    // working perfectly and the rescue exited on its first iteration.
    //
    // Ask the question the trap actually denies, exactly as pillarOut does.
    if (i % 3 === 2 && await canStartAPath(bot)) break
  }
  log('info', 'reflex: dug out', { from: Math.round(startY), to: Math.round(bot.entity.position.y) })
}

/** Sprint toward whichever horizontal direction is open. */
async function walkToOpening(bot) {
  const p = bot.entity.position
  for (const [dx, dz, k] of [[1, 0, 'right'], [-1, 0, 'left'], [0, 1, 'back'], [0, -1, 'forward']]) {
    const a = bot.blockAt(p.offset(dx, 0, dz))
    const b = bot.blockAt(p.offset(dx, 1, dz))
    if (a?.name === 'air' && b?.name === 'air') {
      await bot.look(Math.atan2(-dx, -dz), 0, true).catch(() => {})
      bot.setControlState('forward', true); bot.setControlState('sprint', true)
      await sleep(1200)
      bot.clearControlStates()
      return
    }
  }
}

function pickFood(bot) {
  const items = bot.inventory?.items() ?? []
  for (const name of FOOD_PRIORITY) {
    const hit = items.find(i => i.name === name)
    if (hit) return hit
  }
  return null
}

/** Sprint-jump away from whatever is hurting us. Crude on purpose -- fast beats clever. */
async function escape(bot) {
  bot.setControlState('sprint', true)
  bot.setControlState('forward', true)
  bot.setControlState('jump', true)
  await sleep(1500)
  bot.clearControlStates()
}

/**
 * Break out of a stuck state -- and VERIFY it worked.
 *
 * The first version was a 600ms jump-and-hop. Telemetry over 44 firings showed
 * the agent was in the same place afterwards 35 times: 80% ineffective. A
 * recovery that usually does not recover is barely better than none, and it
 * costs a decision cycle each time.
 *
 * Now it escalates: nudge, then sprint in a random direction, then a real
 * pathfinding move to somewhere genuinely different -- checking after each
 * step whether the agent actually relocated.
 */
/**
 * Can a bot legally stand here? Feet clear, HEAD clear, something solid under.
 *
 * The head check is the one that matters and the one the old unstick ignored.
 * Measured live: a bot at 1,74,0 had open space at foot level in three
 * directions and solid rock at head height in all but one of them, so every
 * "obvious" escape was illegal and it thrashed against stone.
 */
function standableAt(bot, p) {
  const passable = b => !b || b.name === 'air' || b.boundingBox === 'empty'
  const feet = bot.blockAt(p)
  const head = bot.blockAt(p.offset(0, 1, 0))
  const below = bot.blockAt(p.offset(0, -1, 0))
  return passable(feet) && passable(head) && below && below.boundingBox === 'block'
}

/** Legal neighbours, most open first -- openness is a proxy for "leads somewhere". */
function escapeCandidates(bot, tabu = null) {
  const p = bot.entity.position.floored()
  const out = []
  for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]) {
    for (const dy of [0, 1, -1]) {          // step up, level, or down one
      const c = p.offset(dx, dy, dz)
      if (!standableAt(bot, c)) continue
      if (tabu && tabu.has(cellKey(c))) break   // already tried; it did not work
      let open = 0
      for (const [ex, ez] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        if (standableAt(bot, c.offset(ex, 0, ez))) open++
      }
      out.push({ pos: c, open })
      break
    }
  }
  return out.sort((a, b) => b.open - a.open)
}

/**
 * What unstick has already tried, and where it tried it from.
 *
 * Stage 0 grades itself with `escapedCell()` -- "am I on a different block than
 * I started on". Inside a pit that is satisfied perfectly by stepping from one
 * corner to the other, so the escape reported success 74 times out of 74 while
 * the bot went nowhere. Measured on instance #1: the SAME target was chosen 8
 * times (5,74,-3), 6 times (3,73,-5), 5 times (-14,68,-4). The bot was bouncing
 * between two squares of a hole it could walk around but not climb out of --
 * visible in-world as a bot hopping on the spot.
 *
 * Two things were missing. Memory, so the same failed square is not re-chosen;
 * and an INVERSE, so that "I keep unsticking from the same four blocks" is
 * recognised as the horizontal escape having failed rather than having worked.
 *
 * Per-bot rather than module-level, for the same reason the escape counters are:
 * nothing here may leak between two bots sharing a process.
 */
const UNSTICK_MEMORY_MS   = 5 * 60 * 1000   // how long a tried square stays tabu
const UNSTICK_TABU_MAX    = 12
const OSCILLATION_TRIES   = 3               // unsticks from ~one spot before we call it a trap
const OSCILLATION_RADIUS  = 4               // blocks
const unstickHistory = new WeakMap()

const cellKey = c => `${c.x},${c.y},${c.z}`

function unstickMemory(bot) {
  let h = unstickHistory.get(bot)
  if (!h) { h = { tried: [], origins: [] }; unstickHistory.set(bot, h) }
  const cutoff = Date.now() - UNSTICK_MEMORY_MS
  h.tried = h.tried.filter(t => t.at > cutoff).slice(-UNSTICK_TABU_MAX)
  h.origins = h.origins.filter(o => o.at > cutoff)
  return h
}

/**
 * Can this bot begin a journey from where it now stands?
 *
 * Leaving the stuck cell is necessary but not sufficient -- stepping one block
 * sideways inside the same sealed pocket is not an escape. Every one of 108
 * route failures in three hours reported "blocked after 0 leg(s)", i.e. no
 * first leg existed, so that is the exact condition worth testing.
 *
 * Deliberately cheap: a short-range goal with a small think budget. This runs
 * inside a reflex, and a reflex that stalls for seconds deciding whether it
 * succeeded is its own failure.
 */
async function canStartAPath(bot) {
  if (!pkgGoals) return true                       // cannot test; do not block the escape
  const p = bot.entity.position
  const prev = bot.pathfinder.thinkTimeout
  try {
    bot.pathfinder.thinkTimeout = 800
    const path = bot.pathfinder.getPathTo(
      bot.pathfinder.movements,
      new pkgGoals.GoalNear(Math.round(p.x) + 8, Math.round(p.y), Math.round(p.z) + 8, 3),
      800)
    return !!(path && path.path && path.path.length > 0)
  } catch {
    return true                                    // unknown is not a reason to keep thrashing
  } finally {
    bot.pathfinder.thinkTimeout = prev
  }
}

async function unstick(bot) {
  const start = bot.entity.position.clone()
  const startBlock = start.floored()

  // TWO different questions, and they were being asked with one test.
  //
  // `movedEnough` (>= 3 blocks) is a "did this bot make progress toward its
  // task" metric. Stage 0 does not attempt that: it steps to one of the eight
  // ADJACENT standable neighbours, so the furthest it can possibly travel is
  // about 1.73 blocks, and the GoalNear(t, 1) that follows also settles about a
  // block away. A perfect escape therefore scored as a failure, and the bot
  // fell through into the three blind stages that were measured at 16/16
  // failures before stage 0 was written.
  //
  // Measured over three hours: 188 legal steps found, 106 FAILED, and the
  // "genuinely walled in" branch fired ZERO times. Detection was never the
  // problem. The escape was being graded against a threshold it cannot reach.
  //
  // So stage 0 asks the question it is actually answering: are we out of the
  // cell we were stuck in?
  const escapedCell = () => !bot.entity.position.floored().equals(startBlock)
  const movedEnough = () => bot.entity.position.distanceTo(start) >= 3

  // Have we been here before? A pit is walkable inside and sealed on top, so
  // every horizontal escape "succeeds" and none of them get the bot out. Three
  // unsticks from within four blocks means the horizontal answer is the wrong
  // answer -- stop re-deriving it and go UP, which is the only direction that
  // leaves a hole. The entombed branch cannot do this for us: it requires
  // isEntombed(), and an open-topped pit has nothing above the bot's head.
  const mem = unstickMemory(bot)
  const nearby = mem.origins.filter(o => o.pos.distanceTo(start) <= OSCILLATION_RADIUS)
  mem.origins.push({ pos: start.clone(), at: Date.now() })
  if (nearby.length >= OSCILLATION_TRIES - 1) {
    log('error', 'reflex: unstick oscillating -- treating as a pit, pillaring out', {
      attempts: nearby.length + 1,
      at: `${start.x.toFixed(0)},${start.y.toFixed(0)},${start.z.toFixed(0)}`,
    })
    logEvent({ kind: 'unstick_oscillation', status: 'failed',
               detail: `${nearby.length + 1} unsticks within ${OSCILLATION_RADIUS} blocks at ` +
                       `y=${Math.round(start.y)} -- horizontal escape is not working`,
               snapshot: snapshot(bot) })
    const yBefore = bot.entity.position.y
    const invBefore = inventorySummary(bot)
    try { await pillarOut(bot) } catch (e) { log('warn', 'pillar out failed', { err: e.message }) }
    noteReflexInventory(bot, invBefore, 'unstick_oscillation')
    // Same discipline as the entombed branch: "I ran the recovery" and "the bot
    // got out" are different claims, and only the second is worth reporting.
    const climbed = bot.entity ? bot.entity.position.y - yBefore : 0
    if (climbed >= 1) {
      mem.origins = []                 // genuinely somewhere else now
      log('info', 'reflex: pillared out of the pit', { climbed: round1(climbed) })
      return
    }
    log('warn', 'reflex: could not pillar out either, falling through', { climbed: round1(climbed) })
  }

  // 0. LOOK BEFORE THRASHING.
  //
  // The old version's three stages were all blind: a random 600ms nudge, a
  // random sprint, then a pathfind to a random point 18-32 blocks away. In a
  // confined space every one of those is a wall, and the third is unreachable
  // by construction. Measured: 16 attempts, 16 failures, 100% -- the visible
  // symptom being a bot jumping on the spot forever.
  //
  // So: enumerate the neighbours that are ACTUALLY standable and step to the
  // most open one. In the pocket the fleet was trapped in, exactly one of eight
  // neighbours qualified -- findable in a millisecond, invisible to a sprint.
  const tabu = new Set(mem.tried.map(t => t.key))
  seizeBody(bot, 'unstick')
  let options = escapeCandidates(bot, tabu)
  if (!options.length && tabu.size) {
    // Every legal neighbour is one we already tried and that did not work. That
    // is not "walled in" -- it is a pocket we have fully enumerated, which is a
    // stronger statement than any single attempt could make.
    log('warn', 'reflex: every escape square has already been tried', { tried: tabu.size })
    options = escapeCandidates(bot)                  // fall back rather than freeze
  }
  if (options.length) {
    const t = options[0].pos
    mem.tried.push({ key: cellKey(t), at: Date.now() })
    log('info', 'reflex: unstick found a legal step', {
      to: `${t.x},${t.y},${t.z}`, openness: options[0].open, candidates: options.length,
      retried: tabu.has(cellKey(t)) || undefined,
    })
    try {
      await bot.lookAt(t.offset(0.5, 1.6, 0.5), true)
      bot.setControlState('forward', true)
      if (t.y > Math.floor(start.y)) bot.setControlState('jump', true)
      await sleep(900)
      bot.clearControlStates()
      if (escapedCell() && await canStartAPath(bot)) return
      // A short, REACHABLE goal -- unlike the old random distant one.
      if (pkgGoals) {
        await Promise.race([
          bot.pathfinder.goto(new pkgGoals.GoalNear(t.x, t.y, t.z, 1)),
          sleep(6000),
        ])
      }
      bot.clearControlStates()
      if (escapedCell() && await canStartAPath(bot)) return
    } catch { bot.clearControlStates() }
  } else {
    log('warn', 'reflex: unstick found NO standable neighbour -- genuinely walled in')
  }

  // 1. cheap nudge
  bot.setControlState('jump', true)
  bot.setControlState('back', true)
  await sleep(600)
  bot.clearControlStates()
  await bot.look(Math.random() * Math.PI * 2, 0, true).catch(() => {})
  if (movedEnough()) return

  // 2. sprint out of whatever geometry is holding us
  bot.setControlState('sprint', true)
  bot.setControlState('forward', true)
  bot.setControlState('jump', true)
  await sleep(1600)
  bot.clearControlStates()
  if (movedEnough()) return

  // 3. commit to going somewhere else entirely
  try {
    const ang = Math.random() * Math.PI * 2
    const d = 18 + Math.random() * 14
    const gp = pkgGoals && new pkgGoals.GoalNear(
      Math.round(start.x + Math.cos(ang) * d),
      Math.round(start.y),
      Math.round(start.z + Math.sin(ang) * d), 2)
    if (gp) await Promise.race([bot.pathfinder.goto(gp), sleep(9000)])
  } catch { /* pathfinder may refuse; nothing further to try here */ }

  if (!movedEnough()) {
    log('warn', 'reflex: unstick FAILED, still in place', {
      at: `${start.x.toFixed(0)},${start.y.toFixed(0)},${start.z.toFixed(0)}`,
    })
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms))
const round1 = n => Math.round(n * 10) / 10

export { isNight }
// isEntombed is the guard that counted water as a wall and let a bot drown
// while the wrong rescue held the loop. Exported so that is one assertion.
export { isEntombed as isEntombedForTest }
// The WIDE predicate, exported only so a test can pin the documented gap
// between it and `bodyPassable`. Two predicates that must not drift need one
// place that says exactly how they differ.
export { notAWall as notAWallForTest }
// Exported for tests only: the pit geometry that produced 74 false successes is
// pure block arithmetic, and it is worth being able to assert on it directly.
export { escapeCandidates, unstickMemory, standableAt, cellKey,
         OSCILLATION_TRIES, OSCILLATION_RADIUS, UNSTICK_TABU_MAX }
