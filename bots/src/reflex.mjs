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
import { Vec3 } from 'vec3'
import { updateDryMs, DRY_HOLD_MS, SEARCH_RADII } from './water-release.mjs'
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
export function drowningRelease (ashore, { reason = 'ceiling' } = {}) {
  if (ashore) {
    return { kind: 'drowning_escaped', status: 'success', escaped: true, landed: true }
  }
  if (reason === 'no_shore') {
    return { kind: 'drowning_surfaced_stranded', status: 'failed', escaped: false, landed: false }
  }
  return { kind: 'drowning_released_timeout', status: 'failed', escaped: false, landed: false }
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
                              climbCeiling = CLIMB_CEILING }) {
  if (!upIsOpen || entombed || canStartPath) return 'none'
  // Checked BEFORE the block/tool branches: a bot at the build limit with a
  // full inventory of dirt is not one scaffold away from rescue, and asking it
  // for more blocks -- which `need_scaffold` does -- sends the cognitive layer
  // to gather materials for a tower that cannot go anywhere.
  if (typeof y === 'number' && y >= climbCeiling) return 'stranded_high'
  if (haveBlocks && cappedNeedsTool) return 'need_pickaxe'
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
 *
 * WHY RING-ORDERED, AND WHY THE RADIUS GREW
 *
 * radius 10 was too small to find real shorelines: `_drowning_no_shore` fired
 * 1,572 times in twelve hours, and a `no_shore` verdict is not "there is no
 * shore" -- it is "there is no shore within ten blocks", which on open lakes is
 * almost always wrong. But the old scan swept the whole square (441 columns,
 * ~4,000 blockAt calls at radius 10); the same sweep at radius 24 is 2,401
 * columns and roughly 21,600 reads, far too much for a 500ms tick shared with
 * every other reflex.
 *
 * So the scan is ordered by Chebyshev ring, outward, and stops as soon as no
 * further ring COULD improve on what it already has. That stopping rule is
 * exact rather than approximate: every column in ring k has Euclidean distance
 * >= k, so once k exceeds the best distance found, nothing beyond can be
 * nearer. A bot next to a bank pays a few dozen reads; only genuinely open
 * water pays the full sweep, and that is the case where the answer is stable
 * enough for the caller to cache it. `maxReads` bounds the worst case; a scan
 * that hits it returns `partial: true`, which a caller MUST NOT cache as a
 * settled "no shore" -- a bank one ring past the cutoff would then be invisible
 * for the whole TTL.
 *
 * NOTE ON maxRise: deliberately still 2. A larger rise finds TALLER banks, but
 * a bot swimming at the surface cannot mount a ledge three blocks above its
 * feet -- jumping out of water clears about 1.25 -- so raising it would aim the
 * rescue at shore it can reach only in the log. Distance was the limit worth
 * lifting; height was not.
 */
export function shoreRoute (bot, { radius = 24, maxRise = 2, maxReads = 0 } = {}) {
  const none = { dir: null, target: null, dist: Infinity, scanned: 0, partial: false }
  const at = bot?.entity?.position
  if (!at || !bot.blockAt) return none
  const empty = b => b != null && b.boundingBox === 'empty'
  // Deliberately the same ground test as ashore(). If these two ever disagree,
  // the reflex would swim to a spot that does not release it -- the original
  // defect wearing different coordinates.
  const standable = b => !!b && b.name !== 'water' && b.name !== 'bubble_column' &&
                         !b.name.includes('kelp') && !b.name.includes('seagrass') &&
                         b.boundingBox === 'block'

  let best = { dir: null, target: null, dist: Infinity }
  let scanned = 0

  // One Chebyshev shell at a time. Within a shell the order does not matter,
  // because the shell is finished before the stopping rule is re-tested.
  for (let ring = 1; ring <= radius; ring++) {
    // Exact: nothing in this ring or beyond can beat a closer hit already held.
    if (ring > best.dist) break
    // A READ COUNT, NOT A CLOCK. A wall-clock budget would make this function
    // non-deterministic and it is asserted directly by drowning-shore.test.mjs;
    // a scan that returns different answers under test load is not a scan you
    // can pin. Reads are the actual cost anyway.
    if (maxReads > 0 && scanned >= maxReads) {
      return { ...best, scanned, partial: true }
    }
    for (let dx = -ring; dx <= ring; dx++) {
      const onSide = Math.abs(dx) === ring
      for (let dz = -ring; dz <= ring; dz++) {
        // Interior columns belong to a ring already scanned.
        if (!onSide && Math.abs(dz) !== ring) continue
        const d = Math.hypot(dx, dz)
        if (d > radius || d >= best.dist) continue
        // A bank a little above the waterline is still shore; a cliff is not.
        for (let dy = 0; dy <= maxRise; dy++) {
          const foot = at.offset(dx, dy, dz)
          // Charged as the reads actually happen: the ground test short-circuits
          // the other two on most columns, and a budget that bills for reads it
          // never made would bail out of cheap scans early.
          scanned += 1
          if (!standable(bot.blockAt(foot.offset(0, -1, 0)))) continue
          scanned += 2
          if (!empty(bot.blockAt(foot)) || !empty(bot.blockAt(foot.offset(0, 1, 0)))) continue
          best = { dir: 'shore', target: foot, dist: d, rise: dy }
          break
        }
      }
    }
  }
  if (best.dir === null) return { ...none, scanned }
  return { ...best, scanned, partial: false }
}

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
 * WHERE A SWIMMER WITH NO BANK IN SIGHT SHOULD AIM.
 *
 * The first version of this sent every such bot HOME, and that was a bad
 * mistake in an experiment about exploration. A bot that walks east until it
 * runs out of continent is doing exactly what it should; turning it around at
 * the water's edge makes home an attractor and puts a ceiling on how much of
 * the world can ever be seen. It also meant the reflex could own a body for
 * nine minutes dragging it in a direction the bot never chose.
 *
 * So the reflex does not pick a DESTINATION. It preserves an INTENTION, and
 * only falls back to home when there is none to preserve:
 *
 *   1. the target of whatever skill is running -- the bot was going
 *      somewhere, and swimming is how you cross water to get there
 *   2. the nearest place the world model has actually seen land
 *   3. home, for a bot that is genuinely lost
 *
 * A DELIBERATE crossing never reaches this code at all: phase 2 requires
 * `!swimming`, and `swim_to` sets `waterTravel.active`. Columbus keeps his
 * heading; it is the bot who fell in that gets pointed at something.
 */
export function swimBearing ({ current = null, sites = [], at = null, home = null } = {}) {
  const a = current?.args ?? {}
  if (Number.isFinite(Number(a.x)) && Number.isFinite(Number(a.z))) {
    return { x: Number(a.x), z: Number(a.z), phase: 'swim_to_goal' }
  }
  if (at && sites.length) {
    let best = null
    for (const s of sites) {
      if (!Number.isFinite(s?.x) || !Number.isFinite(s?.z)) continue
      const d = Math.hypot(s.x - at.x, s.z - at.z)
      if (!best || d < best.d) best = { x: s.x, z: s.z, d }
    }
    // Only worth aiming at if it beats the walk home; otherwise home is
    // simpler and at least as good.
    if (best && (!home || best.d < Math.hypot(home.x - at.x, home.z - at.z))) {
      return { x: best.x, z: best.z, phase: 'swim_to_known_land' }
    }
  }
  if (home && Number.isFinite(home.x) && Number.isFinite(home.z)) {
    return { x: home.x, z: home.z, phase: 'swim_home' }
  }
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
  if (breathable(head)) return 'float'
  const dir = (typeof route === 'function' ? route() : route)?.dir ?? null
  if (dir === 'up') return 'surface'
  if (dir === 'out') return 'surface_out'
  return 'no_air_route'
}

export function drowningControls({ losing, ashore, route, shore, bearing = null, at = null }) {
  if (ashore) return { forward: false, jump: false, lookAt: null, phase: 'done' }
  // PHASE 1 -- still losing air. Reaching air outranks reaching land; a bot
  // that drowns on the way to a beach is not rescued.
  if (losing) {
    return route?.dir === 'out'
      ? { forward: true, jump: true, lookAt: route.target, phase: 'to_air' }
      : { forward: false, jump: true, lookAt: null, phase: 'up' }
  }
  // PHASE 2 -- breathing, not ashore. This is the phase that did not exist.
  if (shore?.dir === 'shore') {
    return { forward: true, jump: true, lookAt: shore.target, phase: 'to_shore' }
  }
  // NO SHORE IN RANGE. This line used to read `forward: false` -- tread water,
  // hold the head up, and let the ceiling expire "honestly".
  //
  // Measured over 22 days, that is the largest single killer in the project.
  // The ledger for one six-hour window:
  //
  //     _drowning_escaped              1,054   reached land
  //     _drowning_no_shore             4,295   treaded, then dropped
  //     _drowning_reentry              4,185   came straight back
  //     _drowning_surfaced_stranded    2,271
  //     _drowning_released_timeout     1,955
  //
  // 1,054 rescues that held against 8,521 that did not, and 17 of 19 drowning
  // deaths in six hours happened AFTER a release, median 46 seconds later.
  // Treading water is not a neutral wait. It spends the whole ownership
  // ceiling going nowhere and then hands an unowned body back to a cognitive
  // loop that will not act for another thirty seconds, in water, which is why
  // 58 of 61 drowning deaths carry "idle at the moment of death".
  //
  // Swimming is a MODE OF MOVEMENT, not an emergency. A bot in open water with
  // no bank within the scan radius is not in an emergency -- it is somewhere,
  // and it needs to go somewhere else. Any committed bearing beats treading,
  // because the world border is finite and land is not evenly rare. Home is
  // the one direction guaranteed to end on land, and it is already the target
  // every other lost-bot path uses.
  if (bearing && Number.isFinite(bearing.x) && Number.isFinite(bearing.z)) {
    return { forward: true, jump: true, phase: bearing.phase,
             lookAt: { x: bearing.x, y: (at?.y ?? 63), z: bearing.z } }
  }
  // Only with nowhere named to swim to does holding the head up remain the
  // least-bad option.
  return { forward: false, jump: true, lookAt: null, phase: 'no_shore' }
}

export function breathableRoute(bot, { maxUp = 32, maxOut = 8 } = {}) {
  const none = { dir: null, target: null, dist: Infinity }
  const at = bot?.entity?.position
  if (!at || !bot.blockAt) return none
  const head = at.offset(0, 1, 0)
  // Water and air are both boundingBox 'empty'; only air ends a drowning.
  const isAir = b => b != null && b.name !== 'water' && b.boundingBox === 'empty'
  const swimmable = b => b != null && (b.name === 'water' || b.boundingBox === 'empty')

  for (let dy = 1; dy <= maxUp; dy++) {
    const b = bot.blockAt(head.offset(0, dy, 0))
    if (isAir(b)) return { dir: 'up', target: head.offset(0, dy, 0), dist: dy }
    if (!swimmable(b)) break          // solid ceiling: up is not an exit
  }
  // Capped above. Look sideways along each axis for a column that opens.
  let best = none
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    for (let d = 1; d <= maxOut; d++) {
      const p = head.offset(dx * d, 0, dz * d)
      if (!swimmable(bot.blockAt(p))) break        // wall: this axis is closed
      if (isAir(bot.blockAt(p)) && d < best.dist) { best = { dir: 'out', target: p, dist: d }; break }
      // an air pocket one block up counts too -- that is the usual cave shape
      const up = p.offset(0, 1, 0)
      if (isAir(bot.blockAt(up)) && d < best.dist) { best = { dir: 'out', target: up, dist: d }; break }
    }
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
const RESCUE_CEILING_MS = 20_000
const RESCUE_CEILING_MAX_MS = 45_000
const PROGRESS_STALL_MS = 5_000
// Phase 2 re-scans twice a second and the answer barely moves between ticks.
const SHORE_TTL_MS = 2_000
// Worst case ~2,400 columns x 3 reads; this caps a single tick's share of it.
const SHORE_MAX_READS = 6_000
// A release followed within this window by another rescue was not a rescue.
const REENTRY_WINDOW_MS = 60_000

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
  let seizedAt = 0
  // Per-rescue progress, reset at seizure. See RESCUE_CEILING_MS above.
  let shoreCache = null            // { key, at, result }
  let lastShoreTarget = null       // target identity progress is measured against
  let bestShoreDist = Infinity     // closest approach to THAT target
  let bestHomeDist = Infinity      // closest approach to home while crossing
  // CONTINUOUS dry time, not "is ashore right now". Standing on land for a
  // single tick is what `drowning_escaped` used to mean, and 45% of those bots
  // were back in the water immediately -- the release was real, the escape was
  // not. One tick back in the water resets this to zero.
  let dryMs = 0
  let lastProgressAt = 0
  let lastShoreReachable = false   // did the last scan find anywhere to stand?
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
  // Cached because phase 2 asks twice a second and a swimming bot barely moves
  // between ticks. The key includes Y and not just X/Z: a bot that sinks two
  // blocks has a different set of reachable banks, and a horizontally-keyed
  // cache would hand it the answer for a depth it has already left.
  // WHY THIS IS NOT THE WIDEST POLICY RADIUS, MEASURED THE HARD WAY.
  //
  // It was, for two hours, on the placebo-c canary. The reasoning was that
  // shoreRoute walks shells outward and breaks once `ring > best.dist`, so a
  // wider limit only changes what happens when nothing near was found -- free.
  // It is not free, because the READ BUDGET binds first. A shell costs about
  // 19 reads per ring, so a full scan runs ~9.4r^2: radius 24 finishes inside
  // SHORE_MAX_READS with a little room, and anything larger does not finish at
  // all. It bails at `scanned >= maxReads` around ring 25 either way.
  //
  // So the wider radius bought essentially no extra search. What it did buy
  // was `partial: true` on every scan in open water -- and a partial scan is
  // deliberately never cached, because it is not evidence of absence. The scan
  // went from once per SHORE_TTL_MS to once per tick, and `_drowning_no_shore`
  // with it: +61 events per 1,000 water events against the fleet over 2.1h,
  // difference-in-differences. That was the same bots in the same water,
  // logging the same condition four times as often.
  //
  // Widening the search is still the right idea. It needs the read budget
  // raised to match -- ~21k reads for radius 48 -- which is a deliberate CPU
  // decision on a host already at load 8, not a free change.
  const shoreScan = (radius = SEARCH_RADII[0]) => {
    const at = bot.entity?.position
    if (!at) return { dir: null, target: null, dist: Infinity }
    // THE RADIUS IS PART OF THE KEY. Without it, the 24-block scan that found
    // nothing caches as a settled "no shore" and the widened 48-block scan
    // never runs -- the widening would be dead code that reviews clean, which
    // is the same failure as a negative result the system cannot tell from an
    // unasked question.
    const key = `${Math.round(at.x)},${Math.round(at.y)},${Math.round(at.z)}@${radius}`
    const now = Date.now()
    if (shoreCache && shoreCache.key === key && now - shoreCache.at < SHORE_TTL_MS) {
      return shoreCache.result
    }
    const result = shoreRoute(bot, { radius, maxReads: SHORE_MAX_READS })
    // A scan that ran out of budget is not evidence of absence. Caching it as a
    // settled "no shore" would hide a bank one ring past the cutoff for the
    // whole TTL -- the same shape of bug as the original: a negative result the
    // system cannot tell from an unasked question.
    if (!result.partial) shoreCache = { key, at: now, result }
    return result
  }

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
      dryMs = updateDryMs(dryMs, inWater, config.reflex.tickMs)
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

      if (rescuing && !air.losing && !ashore() && !rescueExpired() && !swimming) {
        const shore = shoreScan()
        lastShoreReachable = shore.dir === 'shore'
        if (shore.dir === 'shore') {
          const tk = `${Math.round(shore.target.x)},${Math.round(shore.target.y)},${Math.round(shore.target.z)}`
          if (tk !== lastShoreTarget) {
            // A new target resets the baseline but NOT the clock; see the note
            // on RESCUE_CEILING_MS. Otherwise re-targeting buys free time.
            lastShoreTarget = tk
            bestShoreDist = shore.dist
          } else if (shore.dist < bestShoreDist - 0.5) {
            bestShoreDist = shore.dist
            lastProgressAt = Date.now()
          }
        }
        const ctl = drowningControls({
          losing: false, ashore: false, route: null, shore,
          bearing: swimBearing({
            current: runner?.current,
            sites: worldFacts?.cache?.resources ?? [],
            at: bot.entity?.position,
            home: { x: config.world.homeX, z: config.world.homeZ },
          }),
          at: bot.entity?.position,
        })
        // A crossing owns the body for as long as it is actually crossing.
        // `travelling` is re-derived every tick and falls back to false the
        // moment the phase changes, so a bot that stops swimming stops being
        // exempt -- it cannot latch itself into permanent ownership.
        travelling = ctl.phase?.startsWith('swim_') === true
        if (travelling) {
          // Progress is measured against whatever it is actually aiming at,
          // not against home -- otherwise a bot correctly swimming AWAY from
          // home toward its goal would read as stalled and be released.
          const tgt = ctl.lookAt
          const hd = tgt ? Math.hypot(bot.entity.position.x - tgt.x,
                                      bot.entity.position.z - tgt.z) : Infinity
          if (hd < bestHomeDist - 1) { bestHomeDist = hd; lastProgressAt = Date.now() }
        }
        if (ctl.lookAt) { try { bot.lookAt(ctl.lookAt, true) } catch { /* not connected */ } }
        bot.setControlState('forward', ctl.forward)
        bot.setControlState('jump', ctl.jump)
        if (ctl.phase !== lastDrownPhase) {
          lastDrownPhase = ctl.phase
          logEvent({ kind: `drowning_${ctl.phase}`,
                     status: ctl.phase === 'no_shore' ? 'failed' : 'success',
                     detail: ctl.phase === 'to_shore'
                       ? `breathing; swimming ${shore.dist.toFixed(1)}b to shore at ` +
                         `${Math.round(shore.target.x)},${Math.round(shore.target.y)},${Math.round(shore.target.z)}`
                       : 'breathing but no shore within reach',
                     snapshot: snapshot(bot) })
        }
      }

      // HOLDING A BOT THAT HAS NOWHERE TO GO IS NOT A RESCUE.
      //
      // `!lastShoreReachable` releases immediately instead of pinning the body
      // for the full ceiling. The old code held a surfaced, full-lunged bot at
      // `forward:false, jump:true` for twenty seconds, released it, and re-seized
      // on the next submersion -- so a bot crossing open water lost twenty
      // seconds out of every cycle to a rescue that had already established
      // there was nothing to rescue it to. Open water is not an emergency; it is
      // terrain, and the bot needs its body back to cross it.
      //
      // Phase 2 runs before this branch, so `lastShoreReachable` is this tick's
      // answer and not a stale one.
      // Standing ashore is no longer sufficient on its own, and neither is one
      // scan coming back empty. The other three exits are unchanged: a bot
      // whose air is draining, one past the ceiling, and one crossing water
      // under its own skill are all decided exactly as before.
      if (ashore() && !inWater && dryMs < DRY_HOLD_MS && rescuing && !rescueExpired()) {
        // Hold, but do not FIGHT. Phase 2 does not steer a bot that is ashore,
        // so leaving the swim controls latched would bunny-hop it along the
        // bank for three seconds instead of letting it stand still and dry.
        try { bot.clearControlStates() } catch { /* not connected */ }
      }
      if (!air.losing && breathingAgain(bot.oxygenLevel, recent, airMax) && rescuing &&
          ((ashore() && dryMs >= DRY_HOLD_MS) || rescueExpired() || swimming ||
           !lastShoreReachable)) {
        // THE CEILING IS NOT AN ESCAPE, AND MUST NOT BE LOGGED AS ONE.
        //
        // Both exits released the body under one `drowning_escaped` event, so a
        // bot that merely ran out the 20s ownership ceiling while still floating
        // recorded the same success as one that reached land. That is why
        // `_drowning_route` and `_drowning_escaped` arrive in near-equal pairs --
        // 3,334 and 3,329 over fourteen hours -- while bots stayed pinned in
        // water: the pairs were not evidence of rescue, they were evidence of
        // the loop restarting, and the name hid it.
        //
        // The ceiling still fires. Releasing a body that cannot be saved is
        // correct, because holding it forever starves every other reflex. It is
        // only the CLAIM that changes: an escape is reaching ground that is not
        // water, and everything else is a timeout.
        // WHY THE REASON IS PASSED, AND WHAT IT COST TO LEARN.
        //
        // `drowning_surfaced_stranded` exists to separate two failures that the
        // single timeout counter fused: a bot that ran the clock down SWIMMING AT
        // A BANK failed at execution, and a bot that surfaced into open water with
        // nowhere to stand never had a rescue to execute. They want opposite
        // fixes. The distinction is only real if the caller supplies it -- a
        // three-way release function called with the old boolean silently emits
        // the old two outcomes and the new kind is dead code that reviews clean.
        // A YIELD IS NOT A RESCUE OUTCOME. drowningRelease answers "how did the
        // rescue end"; a crossing that was never an emergency did not have one,
        // and folding it in would put a correct decision into the escape-rate
        // denominator as a failure.
        const rel = swimming
          ? { kind: 'drowning_yielded_to_swim', status: 'success', escaped: false, landed: false }
          : drowningRelease(ashore(), { reason: lastShoreReachable ? 'ceiling' : 'no_shore' })
        rescuing = false
        lastReleaseAt = Date.now()
        lastReleaseKind = rel.kind
        lastDrownPhase = null
        try { bot.clearControlStates() } catch { /* not connected */ }
        logEvent({
          kind: rel.kind,
          status: rel.status,
          detail: rel.escaped
            ? `ashore with oxygen ${bot.oxygenLevel}, health ${bot.health}`
            : `released after ${Math.round((Date.now() - seizedAt) / 1000)}s still in water ` +
              `(oxygen ${bot.oxygenLevel}, health ${bot.health}); ` +
              (rel.kind === 'drowning_yielded_to_swim'
                ? 'a swim_to crossing is in progress — handing the body back'
                : rel.kind === 'drowning_surfaced_stranded'
                ? `no block within reach it could stand on — surfaced, breathing, released to travel`
                : `it was closing on shore at ${bestShoreDist === Infinity ? '?' : bestShoreDist.toFixed(1)}b ` +
                  `and the ceiling expired first`),
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
        if (!emergency && bot.pathfinder?.goal) {
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
        if (mayAct && emergency && air.act === 'swim') {
          const route = breathableRoute(bot)
          // SEIZE ONCE. Taking the body means clearing every control state, so
          // doing it per tick destroys the stroke the previous tick started.
          if (!rescuing) {
            rescuing = true
            seizedAt = Date.now()
            // A RELEASE IS GRADED BY WHAT HAPPENS NEXT, not by what it claimed.
            // Reclassifying an outcome is free; the way to tell a real escape
            // from a renamed one is whether the bot came straight back. If
            // `drowning_escaped` starts arriving with reentries behind it, the
            // escape is decoration and this event is what says so.
            if (lastReleaseAt && Date.now() - lastReleaseAt < REENTRY_WINDOW_MS) {
              logEvent({
                kind: 'drowning_reentry',
                status: 'failed',
                detail: `drowning again ${Math.round((Date.now() - lastReleaseAt) / 1000)}s after ` +
                        `${lastReleaseKind} — that release did not hold`,
                snapshot: snapshot(bot),
              })
            }
            lastProgressAt = Date.now()
            lastShoreTarget = null
            bestShoreDist = Infinity
            bestHomeDist = Infinity
            lastShoreReachable = false
            shoreCache = null
            seizeBody(bot, 'drowning')
            // WHICH WAY, on every rescue -- not just the hopeless ones. Logging
            // only the sealed case left no way to tell whether "up" or "out" was
            // chosen, which is exactly the blind spot that cost three days on the
            // movement bug. Direction and distance, once per rescue.
            logEvent({
              kind: 'drowning_route',
              detail: `${route.dir ?? 'sealed'} dist=${route.dist === Infinity ? -1 : route.dist} ` +
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
        const upIsOpen = !above || above.name === 'air' || above.boundingBox === 'empty'
        const haveBlocks = bot.inventory.items().some(it => PLACEABLE.test(it.name))
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
          : maroonState({ upIsOpen, haveBlocks, entombed: entombedNow,
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
            return { gained: 0, dug: 0, tried: 0 }
          })
          if (got.gained > 0) {
            noteReflexInventory(bot, invBefore, 'maroon_harvest')
            logEvent({ kind: 'marooned_self_sourced', status: 'success',
                       detail: `no route from y=${yNow}; dug ${got.dug} of ${got.tried} ` +
                               `neighbouring block(s) and gained ${got.gained} placeable — ` +
                               `haveBlocks is now true, so the next check climbs`,
                       snapshot: snapshot(bot) })
          } else {
            // Genuinely nothing to take: bedrock, liquid, or everything around
            // needs a tool the bot has not got. NOW the goal layer is the right
            // owner, because the answer really is elsewhere.
            // cognitive.mjs drains this bus on its next tick, the same way the
            // entombed branch and the skill layer hand over a prerequisite.
            bot.pendingPrereq = scaffoldPrereq(
              `no path can start from y=${yNow}, nothing in the inventory to pillar ` +
              `with, and ${got.tried} adjacent block(s) yielded nothing when dug`)
            logEvent({ kind: 'marooned_needs_scaffold', status: 'failed',
                       detail: `no route from y=${yNow}, column above is open, no placeable ` +
                               `blocks, and self-sourcing failed (${got.dug}/${got.tried} dug) ` +
                               `— asked for scaffold`,
                       snapshot: snapshot(bot) })
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
          try { await pillarOut(bot) } catch (e) { log('warn', 'maroon escape failed', { err: e.message }) }
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
      if (!escaping && !marooned && isEntombed(bot) &&
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
        try { await pillarOut(bot) } catch (e) { log('warn', 'pillar out failed', { err: e.message }) }
        noteReflexInventory(bot, invBefore, 'entombed_escape')
        // Verify the postcondition. "I ran the recovery" and "the bot is no
        // longer trapped" are different claims and only the second one counts.
        if (bot.entity && bot.entity.position.y - yBefore < 1 && isEntombed(bot)) escapeFailures++
        else escapeFailures = 0
        escaping = false
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
const passableFor = b =>
  !b || b.name === 'air' || b.name === 'cave_air' || b.name === 'void_air' ||
  b.name === 'water' || b.name === 'bubble_column' || b.name.includes('leaves')

function isEntombed(bot) {
  const p = bot.entity.position

  // A CEILING is the load-bearing condition and the original version lacked it.
  // Without this, "walls on three sides plus higher ground nearby" describes an
  // ordinary hillside, and the reflex fired 1,997 times in 40 minutes at an
  // average y of 64 -- surface level, open sky overhead. Being genuinely
  // entombed means something is above you.
  const ceiling = bot.blockAt(p.offset(0, 2, 0))
  if (passableFor(ceiling)) return false

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

const PLACEABLE = /^(dirt|cobblestone|stone|oak_log|oak_planks|sand|gravel|andesite|diorite|granite|deepslate|cobbled_deepslate)$/
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
// Sides only, at foot and head height. NEVER the floor (digging down drops the
// bot deeper into the trap it is escaping) and NEVER the ceiling (that column is
// the escape route and pillarOut owns it).
const HARVEST_OFFSETS = [
  [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1],
  [1, 1, 0], [-1, 1, 0], [0, 1, 1], [0, 1, -1],
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
 *     widens the pit. A candidate must be PLACEABLE *and* harvestable with what
 *     the bot can actually hold.
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
  let dug = 0, tried = 0

  for (const [dx, dy, dz] of HARVEST_OFFSETS) {
    if (held() >= want || Date.now() > deadline) break
    const b = bot.blockAt(bot.entity.position.offset(dx, dy, dz))
    if (!b || b.boundingBox !== 'block' || !PLACEABLE.test(b.name)) continue
    tried++
    const tool = bestTool(bot, b)
    if (tool) await bot.equip(tool, 'hand').catch(() => {})
    // Bare-handed stone yields nothing; skip rather than pay the dig for free.
    if (b.canHarvest && !b.canHarvest(bot.heldItem?.type ?? null)) continue
    try { await digBounded(bot, b, 6000) } catch { continue }
    dug++
    await sleep(400)   // the drop must reach the bot before the next count
  }
  return { gained: held() - had, dug, tried, had }
}

async function pillarOut(bot, maxBlocks = 24) {
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
    if (!item) { return digStraightUp(bot, startY) }

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
// Exported for tests only: the pit geometry that produced 74 false successes is
// pure block arithmetic, and it is worth being able to assert on it directly.
export { escapeCandidates, unstickMemory, standableAt, cellKey,
         OSCILLATION_TRIES, OSCILLATION_RADIUS, UNSTICK_TABU_MAX }
