// THE TRAVEL BUDGET WAS SMALLER THAN THE MAP.
//
// Measured over a 10.5-hour run of instance #1:
//
//     home   0/162        goto  94/559 = 16%
//
// and all 77 of home's "got within N blocks" failures reported the SAME
// distance -- 383 -- because the leg budget was a hardcoded 8 and MAX_LEG is 45,
// so total travel capped at 360 blocks. Where the bots actually were:
//
//     Scout01 229   Miner01 288   Gather02 383   Solo01 477   Gather01 872
//
// Three of five were further from home than the skill could ever walk. `home`
// was not failing; it was being asked to cover 383 blocks with 360 blocks of
// allowance and correctly reporting that it ran out. The bots could not return,
// could not bank anything, and every death dropped a full inventory.
//
// The 8 was not protecting the 180s watchdog either: a successful goto ran a
// median 16.5s and a worst case of 45s, the worst failure 70s.
import assert from 'node:assert'
import { SKILLS } from '../src/skills.mjs'

let pass = 0, fail = 0
const t = (name, fn) => fn().then(
  () => { pass++; console.log(`  PASS  ${name}`) },
  e  => { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) })

const V = (x, y, z) => ({
  x, y, z,
  clone: () => V(x, y, z),
  offset: (a, b, c) => V(x + a, y + b, z + c),
  distanceTo: o => Math.hypot(x - o.x, y - o.y, z - o.z),
  toFixed: () => `${x},${y},${z}`,
})

/**
 * A bot that walks a fixed number of blocks toward each pathfinder goal, so the
 * leg budget is the only thing under test. `stride` of 0 models a bot that
 * cannot move at all.
 */
function travelBot({ start = V(0, 64, 0), stride = 45 } = {}) {
  const legs = []
  const bot = {
    entity: { position: start },
    registry: { blocks: {}, itemsByName: {} },
    inventory: { items: () => [] },
    blockAt: () => ({ name: 'air', boundingBox: 'empty' }),
    pathfinder: {
      async goto(goal) {
        legs.push({ x: goal.x, z: goal.z, type: goal.constructor.name,
                    hasY: Object.prototype.hasOwnProperty.call(goal, 'y') })
        const p = bot.entity.position
        const d = Math.hypot(goal.x - p.x, goal.z - p.z)
        if (d === 0 || stride === 0) return
        const f = Math.min(1, stride / d)
        bot.entity.position = V(
          p.x + (goal.x - p.x) * f, p.y, p.z + (goal.z - p.z) * f)
      },
    },
  }
  return { bot, legs }
}
// A REAL AbortSignal: the travel path registers a listener on it, so a plain
// { aborted: false } object throws before the first leg even runs.
const go = (bot, x, z, range = 2) =>
  SKILLS.goto.run({ bot }, { x, y: 64, z, range }, new AbortController().signal)

// --- the case that was 0/162 ---------------------------------------------
await t('reaches a target 383 blocks away -- the exact distance that always failed', async () => {
  const { bot } = travelBot({ stride: 45 })
  const r = await go(bot, 383, 0)
  assert.equal(r.status, 'success', `expected to arrive, got: ${r.detail}`)
})

await t('reaches 477 blocks -- Solo01 distance', async () => {
  const { bot } = travelBot({ stride: 45 })
  assert.equal((await go(bot, 477, 0)).status, 'success')
})

await t('the old 8-leg cap would not have been enough', async () => {
  const { legs } = travelBot({ stride: 45 })
  const { bot, legs: used } = travelBot({ stride: 45 })
  await go(bot, 383, 0)
  assert.ok(used.length > 8, `needed more than the old cap of 8, used ${used.length}`)
})

// --- but the budget must stay inside the skill watchdog -------------------
await t('the leg budget is capped so a trip cannot outrun the 180s watchdog', async () => {
  // ~9s per leg measured live; 16 legs is ~145s, inside the 180s timeout.
  const { bot, legs } = travelBot({ stride: 45 })
  await go(bot, 1900, 0)          // as far as the world border allows
  assert.ok(legs.length <= 16, `used ${legs.length} legs, over the safe cap`)
})

// --- partial progress must be distinguishable from going nowhere ----------
await t('a trip too long for one call reports progress, not a flat failure', async () => {
  const { bot } = travelBot({ stride: 45 })
  const r = await go(bot, 1500, 0)       // beyond one budget
  assert.equal(r.status, 'failed', 'it genuinely did not arrive')
  assert.equal(r.failClass, 'travel_incomplete')
  assert.match(r.detail, /closed \d+ of \d+ blocks/)
  assert.match(r.detail, /call again to continue/)
})

// A bot with stride 0 is not an artificial case -- it is the library's real
// behaviour, faithfully modelled. mineflayer-pathfinder/lib/goto.js resolves
// (no error) whenever A* returns an empty path, testing `path.length === 0`
// BEFORE it tests `status === 'noPath'`. So "I cannot generate a single move
// from here" arrives as a fulfilled promise, exactly as this fake does.
//
// We only measured displacement in the catch branch, so each no-op leg counted
// as a leg completed. Live: 12 of 14 such failures moved 0 blocks while
// reporting 8 legs, all 8 burned in 453-712ms.
await t('a bot that cannot move at all is NOT reported as progress', async () => {
  const { bot, legs } = travelBot({ stride: 0 })
  const r = await go(bot, 400, 0)
  assert.equal(r.status, 'failed')
  assert.equal(r.failClass, 'stranded',
    'a resolved-but-motionless leg means this bot cannot leave its own square, ' +
    'which is a different problem from no route existing to the destination')
  assert.equal(legs.length, 1,
    'it must stop on the FIRST no-op leg, not spend the whole budget discovering ' +
    'the same thing eight times')
  assert.match(r.detail, /empty path/, `detail should name the cause: ${r.detail}`)
})

await t('a stranded report names where the bot is, not where it wanted to go', async () => {
  // The remedy for stranded is about the bot's CURRENT position -- climb out,
  // dig out, relocate -- so the position has to be in the message.
  const { bot } = travelBot({ stride: 0 })
  const r = await go(bot, 400, 0)
  assert.match(r.detail, /no route out of here/, r.detail)
  assert.match(r.gap ?? '', /^stranded_y/, `gap should group by elevation: ${r.gap}`)
})

// --- the gap must move as the bot moves, or the store punishes progress ---
await t('the reported gap shrinks as the bot gets closer', async () => {
  const { bot: b1 } = travelBot({ stride: 45 })
  const first = await go(b1, 1500, 0)
  const second = await go(b1, 1500, 0)   // same bot, now much closer
  assert.notEqual(first.gap, second.gap,
    'an unchanging gap makes the lessons store treat steady progress as a repeated failure')
})

// --- short trips must not regress ----------------------------------------
await t('a short hop still arrives and still says arrived', async () => {
  const { bot, legs } = travelBot({ stride: 45 })
  const r = await go(bot, 30, 0)
  assert.equal(r.status, 'success')
  assert.match(r.detail, /arrived/)
  assert.ok(legs.length <= 2, `a 30-block hop should not need ${legs.length} legs`)
})

await t('arriving already at the target costs no legs', async () => {
  const { bot, legs } = travelBot({ stride: 45 })
  const r = await go(bot, 0, 0)
  assert.equal(r.status, 'success')
  assert.equal(legs.length, 0)
})

// --- intermediate waypoints must not constrain elevation ------------------
//
// `leg` is a straight-line interpolation toward the target, so its y is whatever
// a ruler through the terrain passes through -- often inside a hill or in
// mid-air. Asking for a specific y there made A* search for somewhere that does
// not exist and report Timeout: 117 of the goto failures over 10.5 hours.
await t('intermediate legs ask for a COLUMN, not an elevation', async () => {
  const { bot, legs } = travelBot({ stride: 45 })
  await go(bot, 400, 0)
  const middle = legs.slice(0, -1)
  assert.ok(middle.length > 0, 'this trip should need several legs')
  for (const l of middle) {
    assert.equal(l.type, 'GoalNearXZ',
      `an intermediate waypoint used ${l.type}, which pins a y the terrain may not have`)
  }
})

await t('the final approach DOES honour the requested elevation', async () => {
  const { bot, legs } = travelBot({ stride: 45 })
  await go(bot, 400, 0)
  const last = legs[legs.length - 1]
  assert.equal(last.type, 'GoalNear', 'the caller asked for a specific spot; the last leg must respect it')
})

await t('a short hop is a final leg and keeps its elevation', async () => {
  const { bot, legs } = travelBot({ stride: 45 })
  await go(bot, 20, 0)
  assert.equal(legs[0].type, 'GoalNear')
})

console.log(`  ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
