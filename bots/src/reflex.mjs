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
export function drowningRelease(ashore) {
  return ashore
    ? { kind: 'drowning_escaped', status: 'success', escaped: true }
    : { kind: 'drowning_released_timeout', status: 'failed', escaped: false }
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
export function maroonState({ upIsOpen, haveBlocks, entombed, canStartPath }) {
  if (!upIsOpen || entombed || canStartPath) return 'none'
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

export function airConsequenceEvidence(bot, air, { oxygenSamples = [], previousHealth = null } = {}) {
  if (!air?.losing) return false

  const h = bot?.health
  if (h != null && previousHealth != null && h < previousHealth) return true

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
export function shoreRoute(bot, { radius = 10, maxRise = 2 } = {}) {
  const none = { dir: null, target: null, dist: Infinity }
  const at = bot?.entity?.position
  if (!at || !bot.blockAt) return none
  const empty = b => b != null && b.boundingBox === 'empty'
  // Deliberately the same ground test as ashore(). If these two ever disagree,
  // the reflex would swim to a spot that does not release it -- the original
  // defect wearing different coordinates.
  const standable = b => !!b && b.name !== 'water' && b.name !== 'bubble_column' &&
                         !b.name.includes('kelp') && !b.name.includes('seagrass') &&
                         b.boundingBox === 'block'

  let best = none
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      if (dx === 0 && dz === 0) continue
      const d = Math.hypot(dx, dz)
      if (d > radius || d >= best.dist) continue
      // A bank a little above the waterline is still shore; a cliff is not.
      for (let dy = 0; dy <= maxRise; dy++) {
        const foot = at.offset(dx, dy, dz)
        if (!standable(bot.blockAt(foot.offset(0, -1, 0)))) continue
        if (!empty(bot.blockAt(foot)) || !empty(bot.blockAt(foot.offset(0, 1, 0)))) continue
        best = { dir: 'shore', target: foot, dist: d, rise: dy }
        break
      }
    }
  }
  return best
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
export function drowningControls({ losing, ashore, route, shore }) {
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
  // No reachable shore. Do not thrash: hold the head up and let the ceiling
  // expire honestly, which is what open ocean should look like.
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
      if (!air.losing && breathingAgain(bot.oxygenLevel, recent, airMax) && rescuing &&
          (ashore() || Date.now() - seizedAt > 20_000)) {
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
        const rel = drowningRelease(ashore())
        rescuing = false
        lastDrownPhase = null
        try { bot.clearControlStates() } catch { /* not connected */ }
        logEvent({
          kind: rel.kind,
          status: rel.status,
          detail: rel.escaped
            ? `ashore with oxygen ${bot.oxygenLevel}, health ${bot.health}`
            : `released after ${Math.round((Date.now() - seizedAt) / 1000)}s still in water ` +
              `(oxygen ${bot.oxygenLevel}, health ${bot.health}) — the ceiling expired, ` +
              `the bot did not reach land`,
          snapshot: snapshot(bot),
        })
      }
      // Detection is allowed to be noisy; the BODY is not.
      const mayAct = airConsequenceEvidence(bot, air, {
        oxygenSamples: airSamples.slice(-6),
        previousHealth: prevHealth,
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
        // Unconditional: not latched, not throttled. Drowning damage lands about
        // once a second, so an 8s gate is a death sentence.
        if (mayAct && air.act === 'swim') {
          const route = breathableRoute(bot)
          // SEIZE ONCE. Taking the body means clearing every control state, so
          // doing it per tick destroys the stroke the previous tick started.
          if (!rescuing) {
            rescuing = true
            seizedAt = Date.now()
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
          const nowAshore = ashore()
          const shore = (!air.losing && !nowAshore) ? shoreRoute(bot) : null
          const ctl = drowningControls({ losing: air.losing, ashore: nowAshore, route, shore })
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
                         : `phase ${ctl.phase}`,
                       snapshot: snapshot(bot) })
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
        const mstate = (!upIsOpen || entombedNow)
          ? 'none'
          : maroonState({ upIsOpen, haveBlocks, entombed: entombedNow,
                          canStartPath: await canStartAPath(bot) })
        if (mstate === 'need_scaffold' &&
            Date.now() - lastMaroonPrereqAt > MAROON_PREREQ_COOLDOWN_MS) {
          lastMaroonPrereqAt = Date.now()
          // cognitive.mjs drains this bus on its next tick, the same way the
          // entombed branch and the skill layer hand over a prerequisite.
          bot.pendingPrereq = scaffoldPrereq(
            `no path can start from y=${Math.round(bot.entity.position.y)} and there is ` +
            `nothing in the inventory to pillar with`)
          logEvent({ kind: 'marooned_needs_scaffold', status: 'failed',
                     detail: `no route from y=${Math.round(bot.entity.position.y)}, column above ` +
                             `is open, but no placeable blocks — asked for scaffold`,
                     snapshot: snapshot(bot) })
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
