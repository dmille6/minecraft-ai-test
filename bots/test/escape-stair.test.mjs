/**
 * THE 71.4%: A MATERIALS DEADLOCK, AND A MOVE THAT NEEDS NO MATERIALS.
 *
 * `harvestAdjacent` succeeds 0.4% of the time. Over a full walk of the fleet
 * logs (37,778 parsed failures, which is the denominator for every share here):
 *
 *     dug 0, tried 8   71.4%   all eight neighbours in the vocabulary, NONE
 *                              harvestable bare-handed
 *     dug 0, tried 0   20.5%   nothing solid adjacent (bots marooned HIGH)
 *     dug 0, tried 4    5.8%
 *
 * and `tried >= 6` is 98.4% of failures at y 0-39. scaffold-vocabulary.test.mjs
 * fixed the FIRST bucket and said of the second: "stone with no pickaxe, and no
 * widening can touch it." That is right. Widening the vocabulary cannot help,
 * because the refusal is correct -- bare-handed stone drops nothing, so a dig
 * that yields no item merely widens the pit.
 *
 * This file is about the second bucket, and the fix is not a widening. Every
 * exit this codebase owns spends an item: `pillarOut` and `shaftAscend` place
 * blocks, `digStraightUp` needs a spare pickaxe, `harvestAdjacent` needs a
 * harvestable neighbour. A 1:1 walkable ramp spends nothing. It is the only
 * ascent in the system with no material precondition, and `digbudget.mjs`
 * already wrote down the fact it rests on: "BREAKING BY HAND IS THE POINT.
 * Stone and deepslate broken bare-handed drop NOTHING... a climb wants the
 * hole, not the cobble."
 *
 * WHAT THIS FILE IS REALLY GUARDING is not the ramp. It is the two ways adding
 * a rescue has gone wrong here before:
 *
 *   1. A NEW REFUSAL MEETING AN OLD ONE. Four traps were two individually
 *      correct guards leaving the bot no legal move, and every one passed its
 *      own unit tests. So the chain is tested, not the guard: `harvestAdjacent`
 *      is run to its real 0/N failure on the measured terrain, and the ramp is
 *      asked for a move FROM THAT STATE. And the refusing case is pinned too --
 *      when the ramp declines, the bot must be left in exactly the state it was
 *      in before the ramp existed, or the composition has cost it something.
 *
 *   2. A WATER PREDICATE ANSWERING A QUESTION NOBODY ASKED. Widening `isWet()`
 *      into kelp multiplied drownings sevenfold; a global reflex demotion
 *      multiplied them 7.5x; a wet check as a veto refused 561 of 566 pillar
 *      attempts. "Swimming is travel, not danger" is a standing owner
 *      directive. So there is a test for a bot whose ONLY viable bearing is
 *      wet, and two mutants that turn the lava check into a liquid check and
 *      the wetness ordering into a veto -- both must be killed by that one
 *      test, which is what makes it a guard against the re-widening rather
 *      than a description of today's code.
 */
import assert from 'node:assert'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import {
  stairUpStep, stairUpRunway, stairUpWetness, chooseStairUpBearing,
} from '../src/scaffold.mjs'
import { escapeBearings, escapeStairUp, harvestAdjacent } from '../src/reflex.mjs'
import { stairBearings } from '../src/skills.mjs'

let pass = 0, fail = 0
const t = (name, fn) => Promise.resolve()
  .then(fn)
  .then(() => { pass++; console.log(`  PASS  ${name}`) })
  .catch(e => { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) })

const SCAFFOLD_PATH = new URL('../src/scaffold.mjs', import.meta.url)
const REFLEX_PATH = new URL('../src/reflex.mjs', import.meta.url)

// VERBATIM from climb-escape.test.mjs:447-458. It writes a separate module and
// never touches src/, which matters more than style here: run-tests.mjs kills a
// slow file with an uncatchable SIGKILL, so a patch that mutates src/ in place
// can leave corrupted source on disk -- and fleet-recycle restarts every bot
// onto $H/src every six hours.
async function withMutant (path, old, neu, fn) {
  const src = readFileSync(path, 'utf8')
  assert.ok(src.includes(old),
    `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))} is not in ${path.pathname}. ` +
    'A mutant that was never written reads as killed.')
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
  // test/ is one level under bots/, so './x.mjs' has to become '../src/x.mjs'.
  const body = src.replace(old, neu).replace(/from '\.\//g, "from '../src/")
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, body)
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}

// --- terrain ----------------------------------------------------------------

// Bare-handed break times from the deployed registry, the same numbers
// digbudget.mjs is written against. `planDig` caps at 30s, so stone/deepslate
// pass and obsidian does not -- and the fixture has to carry real values or the
// obsidian refusal would pass for the wrong reason.
const DIG_MS = {
  stone: 7500, andesite: 7500, granite: 7500, diorite: 7500, tuff: 7500,
  cobblestone: 10_000, deepslate: 15_000, iron_ore: 15_000,
  cobbled_deepslate: 17_500, dirt: 750, gravel: 3000, obsidian: 250_000,
}

/**
 * A block, from a name. Liquids get an EMPTY boundingBox because that is what
 * the real registry reports, and a fixture that handed water back as solid
 * would let the water tests pass without the behaviour they exist to prove.
 */
function blk (name, pos) {
  if (name === 'air' || !name) return { name: 'air', boundingBox: 'empty', position: pos }
  if (name === 'water' || name === 'lava') return { name, boundingBox: 'empty', position: pos }
  if (name === 'bedrock') {
    return { name, boundingBox: 'block', position: pos, diggable: false, digTime: () => null }
  }
  return {
    name, boundingBox: 'block', position: pos, diggable: true,
    digTime: () => DIG_MS[name] ?? 7500,
    // WITHOUT THIS THE POSITIVE CONTROL IS A LIE. `harvestAdjacent` skips a
    // neighbour at `if (b.canHarvest && !b.canHarvest(...))`, so a fixture
    // block with no `canHarvest` at all sails through the very refusal this
    // file exists to reproduce -- and the first run of this test did exactly
    // that, reporting 12 stone blocks harvested bare-handed.
    canHarvest: type => (BARE_HANDED.test(name) ? true : type === 101),
  }
}

/** What an empty hand can take AND keep. Stone-class is deliberately absent. */
const BARE_HANDED = /^(dirt|coarse_dirt|rooted_dirt|grass_block|sand|gravel)$/

const V = (x, y, z) => ({
  x, y, z,
  offset: (a, b, c) => V(x + a, y + b, z + c),
  clone: () => V(x, y, z),
})

/**
 * A world addressed in coordinates RELATIVE TO THE BOT'S START, because every
 * offset in the code under test is relative to the feet and a fixture that
 * forced the reader to add 15 back would hide its own mistakes.
 *
 * `solidBelow` fills everything under the start plane with stone: the bots this
 * is for are inside rock, and a fixture that left a void under the tread would
 * be testing a bot standing on nothing.
 */
function world (cells = {}, { fillBelow = 'stone', fillElse = 'stone' } = {}) {
  const m = new Map(Object.entries(cells))
  return {
    get (x, y, z) {
      const k = `${x},${y},${z}`
      if (m.has(k)) return m.get(k)
      if (y <= -1) return fillBelow
      return fillElse
    },
    set (x, y, z, name) { m.set(`${x},${y},${z}`, name) },
  }
}

/** `at` in the shape the pure functions take: (dx,dy,dz) -> block. */
const atOf = w => (dx, dy, dz) => blk(w.get(dx, dy, dz), V(dx, dy, dz))

const N = { x: 0, z: -1 }, S = { x: 0, z: 1 }, E = { x: 1, z: 0 }, W = { x: -1, z: 0 }

/**
 * The terrain thirteen bots are standing in: a one-block pocket in solid stone
 * with the ceiling open. `upIsOpen` is true (that is what routes them to
 * `need_scaffold` rather than the entombed branch) and every one of the twelve
 * HARVEST_OFFSETS is stone.
 */
const POCKET = () => world({
  '0,0,0': 'air', '0,1,0': 'air', '0,2,0': 'air', '0,3,0': 'air',
})

// --- the bot ----------------------------------------------------------------

/**
 * A bot that MOVES when the geometry says it can.
 *
 * The step is modelled on `setControlState('forward')` reading the last `look`:
 * the walk succeeds exactly when the tread is solid and both entered cells are
 * clear. That is deliberate -- it is the same condition the code under test
 * claims to have arranged, so a ramp that digs the wrong cells fails to move
 * and the "cut a step but could not stand in it" branch is reachable rather
 * than decorative.
 */
function makeBot (w, { y = -15, inv = [], held = null, canPath = false } = {}) {
  const digs = []            // {name, held} -- what was in hand for each swing
  let yaw = 0
  const bot = {
    digs, world: w,
    entity: { position: V(0, y, 0), get yaw () { return yaw } },
    heldItem: held,
    inventory: { items: () => inv },
    blockAt (p) { return blk(w.get(p.x, p.y - y, p.z), p) },
    async unequip () { bot.heldItem = null },
    async equip (item) { bot.heldItem = item },
    async dig (b) {
      digs.push({ name: b.name, held: bot.heldItem?.name ?? null })
      w.set(b.position.x, b.position.y - y, b.position.z, 'air')
    },
    stopDigging () {}, clearControlStates () {},
    async look (a) { yaw = a },
    setControlState (name, on) {
      if (name !== 'forward' || !on) return
      // Recover the bearing from the yaw the code just looked to. `look` is
      // called as atan2(-x, -z), so this inverts EXACTLY that -- and the order
      // is [N,W,S,E], not skills.mjs's [S,W,N,E], because those two conventions
      // disagree about which way yaw zero points. The fixture has to follow the
      // conversion the code actually turns the bot with, or a correct step
      // would read as "cut a step but could not stand in it".
      const bear = [N, W, S, E][((Math.round(yaw / (Math.PI / 2)) % 4) + 4) % 4]
      const at = (dx, dy, dz) => blk(w.get(dx, dy, dz), V(dx, dy, dz))
      const rel = { x: bot.entity.position.x, z: bot.entity.position.z }
      const dy = bot.entity.position.y - y
      const tread = at(rel.x + bear.x, dy, rel.z + bear.z)
      const feet = at(rel.x + bear.x, dy + 1, rel.z + bear.z)
      const head = at(rel.x + bear.x, dy + 2, rel.z + bear.z)
      const clear = b => b.boundingBox === 'empty'
      if (tread.boundingBox !== 'block' || !clear(feet) || !clear(head)) return
      bot.entity.position = V(rel.x + bear.x, bot.entity.position.y + 1, rel.z + bear.z)
    },
    pathfinder: {
      thinkTimeout: 1000,
      setGoal () {},
      getPathTo () { return canPath ? { path: [1, 2, 3] } : { path: [] } },
    },
  }
  return bot
}

// ============================================================================
// A. THE GEOMETRY. Every one of these is a decision, not a shape.
// ============================================================================

await t('a solid tread with stone above it is a step, and the cells are dug TOP DOWN', () => {
  const r = stairUpStep({ at: atOf(POCKET()), bear: E })
  assert.ok(r.ok, `expected a legal step, got: ${r.reason}`)
  assert.deepStrictEqual(r.dig, [[1, 3, 0], [1, 2, 0], [1, 1, 0]],
    'three cells, highest first: a falling column over an already-open cell ' +
    'pours gravel into the space the bot walks into')
})

await t('an already-open corridor upward is a FREE step: nothing to dig', () => {
  const w = POCKET()
  w.set(1, 1, 0, 'air'); w.set(1, 2, 0, 'air'); w.set(1, 3, 0, 'air')
  const r = stairUpStep({ at: atOf(w), bear: E })
  assert.ok(r.ok, r.reason)
  assert.deepStrictEqual(r.dig, [], 'passable cells must not be dug')
})

await t('THE THIRD CELL: a step that skips the jump clearance stalls the ramp at one', () => {
  // The regression this exists for. With only two cells dug, the bot lands
  // where `at(0,2,0)` is untouched stone and the NEXT step refuses itself for
  // headroom -- invisible to any single-step test, which is why the runway is
  // the unit under test here.
  assert.strictEqual(stairUpRunway({ at: atOf(POCKET()), bear: E, depth: 4 }), 4,
    'a ramp through solid rock must be able to run, not cut one step and stop')
})

await t('no tread means no step: the ramp never breaks a floor and never steps into a hole', () => {
  const w = POCKET()
  w.set(1, 0, 0, 'air')           // a ledge: the cell one along is open air
  const r = stairUpStep({ at: atOf(w), bear: E })
  assert.strictEqual(r.ok, false)
  assert.match(r.reason, /no tread/, r.reason)
})

await t('a water TREAD is refused — a standability fact, not an opinion about water', () => {
  const w = POCKET()
  w.set(1, 0, 0, 'water')
  const r = stairUpStep({ at: atOf(w), bear: E })
  assert.strictEqual(r.ok, false)
  assert.match(r.reason, /no tread/, r.reason)
})

await t('WATER IN THE STEP IS NOT A REFUSAL — it is passable, so there is nothing to dig', () => {
  const w = POCKET()
  w.set(1, 1, 0, 'water'); w.set(1, 2, 0, 'water'); w.set(1, 3, 0, 'water')
  const r = stairUpStep({ at: atOf(w), bear: E })
  assert.ok(r.ok, `water must never close a step; got: ${r.reason}`)
  assert.deepStrictEqual(r.dig, [], 'water is not broken, it is swum through')
})

await t('lava IN the step closes it', () => {
  const w = POCKET()
  w.set(1, 1, 0, 'lava')
  const r = stairUpStep({ at: atOf(w), bear: E })
  assert.strictEqual(r.ok, false)
  assert.match(r.reason, /lava/, r.reason)
})

await t('lava AGAINST a cell the bot walks into closes the step', () => {
  const w = POCKET()
  w.set(2, 1, 0, 'lava')          // a face of the feet cell
  const r = stairUpStep({ at: atOf(w), bear: E })
  assert.strictEqual(r.ok, false)
  assert.match(r.reason, /lava against/, r.reason)
})

await t('lava beside the TREAD does not: the tread is stood on, never entered', () => {
  const w = POCKET()
  w.set(2, 0, 0, 'lava')          // beside the tread, a block below the feet
  const r = stairUpStep({ at: atOf(w), bear: E })
  assert.ok(r.ok, `expected the asymmetry dryColumnStep already draws; got: ${r.reason}`)
})

await t('bedrock and obsidian close a bearing when canBreak says so', () => {
  const w = POCKET()
  w.set(1, 2, 0, 'bedrock')
  const canBreak = b => b.diggable !== false && (b.digTime?.() ?? 0) <= 30_000
  const r = stairUpStep({ at: atOf(w), bear: E, canBreak })
  assert.strictEqual(r.ok, false)
  assert.match(r.reason, /cannot clear bedrock/, r.reason)

  const w2 = POCKET()
  w2.set(1, 1, 0, 'obsidian')
  const r2 = stairUpStep({ at: atOf(w2), bear: E, canBreak })
  assert.strictEqual(r2.ok, false)
  assert.match(r2.reason, /cannot clear obsidian/, r2.reason)
})

await t('deepslate does NOT close a bearing: slow by hand is not hopeless', () => {
  const w = POCKET()
  w.set(1, 1, 0, 'cobbled_deepslate'); w.set(1, 2, 0, 'deepslate')
  const canBreak = b => b.diggable !== false && (b.digTime?.() ?? 0) <= 30_000
  const r = stairUpStep({ at: atOf(w), bear: E, canBreak })
  assert.ok(r.ok, `17.5s and 15s are inside planDig's 30s cap; got: ${r.reason}`)
})

await t('no headroom over the bot means no jump, whatever is ahead', () => {
  const w = POCKET()
  w.set(0, 2, 0, 'stone')
  const r = stairUpStep({ at: atOf(w), bear: E })
  assert.strictEqual(r.ok, false)
  assert.match(r.reason, /headroom/, r.reason)
})

await t('unloaded terrain closes the bearing rather than being dug into blind', () => {
  const at = (dx, dy, dz) => (dx === 1 && dy === 1 ? null : blk(POCKET().get(dx, dy, dz), V(dx, dy, dz)))
  const r = stairUpStep({ at, bear: E })
  assert.strictEqual(r.ok, false)
  assert.match(r.reason, /not loaded/, r.reason)
})

// ============================================================================
// B. THE CHOOSER. Runway first, wetness only as an ordering.
// ============================================================================

await t('a runway counts consecutive steps, and stops where the ramp would', () => {
  const w = POCKET()
  // Step 1 stands the bot at (1,+1); step 2 must clear (2,+2),(2,+3),(2,+4).
  // Bedrock at (2,+3) is inside step 2 and outside step 1.
  w.set(2, 3, 0, 'bedrock')
  const canBreak = b => b.diggable !== false
  assert.strictEqual(stairUpRunway({ at: atOf(w), bear: E, depth: 4, canBreak }), 1,
    'the second step must be the one that refuses')
  assert.strictEqual(stairUpRunway({ at: atOf(POCKET()), bear: E, depth: 4, canBreak }), 4,
    'and clear rock must run the full depth: a positive control for the line above')
})

await t('the bearing with the longest runway wins over the way the bot is facing', () => {
  const w = POCKET()
  w.set(0, 1, 1, 'bedrock')       // south, the facing direction, dies at once
  const canBreak = b => b.diggable !== false
  const c = chooseStairUpBearing({ at: atOf(w), bearings: escapeBearings(0), depth: 4, canBreak })
  assert.ok(c.runway > 0, 'a blocked facing must not end the search')
  assert.notDeepStrictEqual(c.bear, S, 'south refused; the chooser must have turned')
})

await t('on a tie the bot does not turn for nothing', () => {
  const c = chooseStairUpBearing({ at: atOf(POCKET()), bearings: escapeBearings(0), depth: 4 })
  assert.deepStrictEqual(c.bear, escapeBearings(0)[0],
    'all four run the full depth, so keep facing')
  assert.deepStrictEqual(c.bear, N,
    'and at yaw 0 the way the bot faces is NORTH -- see the round-trip test below')
})

await t('wetness ORDERS equal bearings and the dry one is taken', () => {
  const w = POCKET()
  w.set(0, 1, 1, 'water')         // south runs, but wet
  const c = chooseStairUpBearing({ at: atOf(w), bearings: escapeBearings(0), depth: 4 })
  assert.strictEqual(stairUpWetness({ at: atOf(w), bear: S, depth: 4 }) > 0, true,
    'the fixture must actually be wet, or this test proves nothing')
  assert.notDeepStrictEqual(c.bear, S, 'a dry cardinal of equal runway must win')
  assert.strictEqual(c.wet, 0)
})

await t('WATER NEVER VETOES: when the only bearing that runs is wet, the bot still climbs', () => {
  // East is the one open direction and it is flooded. Every other cardinal is
  // bedrock, so a wet veto anywhere in this path leaves the bot with no move --
  // which is the trap, not the fix.
  const w = POCKET()
  for (const [x, z] of [[0, 1], [0, -1], [-1, 0]]) {
    w.set(x, 1, z, 'bedrock'); w.set(x, 2, z, 'bedrock')
  }
  w.set(1, 1, 0, 'water'); w.set(1, 2, 0, 'water')
  const canBreak = b => b.diggable !== false
  const c = chooseStairUpBearing({ at: atOf(w), bearings: escapeBearings(0), depth: 1, canBreak })
  assert.deepStrictEqual(c.bear, E, `expected the wet-but-open bearing, got ${JSON.stringify(c)}`)
  assert.ok(c.runway > 0, 'the wet bearing must still have a runway')
  assert.ok(stairUpStep({ at: atOf(w), bear: E, canBreak }).ok,
    'and the step itself must be legal: swimming is travel, not danger')
})

await t('runway 0 is reported, not acted on', () => {
  const w = POCKET()
  for (const [x, z] of [[0, 1], [0, -1], [-1, 0], [1, 0]]) {
    w.set(x, 1, z, 'bedrock'); w.set(x, 2, z, 'bedrock')
  }
  const canBreak = b => b.diggable !== false
  const c = chooseStairUpBearing({ at: atOf(w), bearings: escapeBearings(0), depth: 4, canBreak })
  assert.strictEqual(c.runway, 0)
})

await t('THE COMPASS ROUND-TRIPS: the first bearing is the way the bot is FACING', () => {
  // THIS REPLACED AN AGREEMENT TEST, and the replacement is the point. The old
  // assertion was `escapeBearings(yaw)` deepEqual `stairBearings({entity:{yaw}})`
  // -- two modules agreeing, which is not evidence either is right, and they
  // were both wrong by two quadrants. `escapeStairUp` turns the bot with
  // mineflayer's own `bot.look(atan2(-x, -z))`, so THAT is the inverse the list
  // has to satisfy, and it is checkable without reference to anyone's opinion:
  // convert the preferred bearing back to a yaw and it must land in the
  // quadrant it was asked about.
  //
  // Before the fix, `escapeBearings(0)[0]` was {x:0,z:1} -- south -- whose yaw
  // is PI. The bot turned a hundred and eighty degrees on every tie while the
  // comment above the array claimed it did not turn for nothing.
  for (let q = 0; q < 4; q++) {
    const yaw = q * (Math.PI / 2)
    const order = escapeBearings(yaw)
    assert.strictEqual(order.length, 4, 'all four cardinals must still be offered')
    const back = Math.atan2(-order[0].x, -order[0].z)
    const backQ = ((Math.round(back / (Math.PI / 2)) % 4) + 4) % 4
    assert.strictEqual(backQ, q,
      `quadrant ${q}: the preferred bearing ${JSON.stringify(order[0])} converts back to ` +
      `quadrant ${backQ}, so the ramp would turn away from the way the bot is pointed`)
    assert.strictEqual(`${order[3].x},${order[3].z}`, `${-order[0].x || 0},${-order[0].z || 0}`,
      'the reverse must be LAST: it is the only turn that walks back over the ' +
      'ground the bot just crossed')
    assert.strictEqual(new Set(order.map(o => `${o.x},${o.z}`)).size, 4,
      `duplicate bearings offered: ${JSON.stringify(order)}`)
  }
})

await t('POSITIVE CONTROL: skills.mjs stairBearings does NOT satisfy that invariant', () => {
  // The disagreement, stated rather than hidden. `stairBearings` indexes from
  // south and nothing in `mine` ever converts a bearing back into a look, so
  // the consequence there is only that the descent prefers to run behind the
  // bot -- a preference bug, not a safety one, and out of scope for this patch.
  // Written as a test so that if someone fixes it, this line goes red and the
  // note in reflex.mjs that says it is still broken stops being a lie.
  const first = stairBearings({ entity: { yaw: 0 } })[0]
  const back = Math.abs(Math.atan2(-first.x, -first.z))
  assert.strictEqual(Math.round(back * 100) / 100, Math.round(Math.PI * 100) / 100,
    'skills.mjs now agrees with mineflayer about yaw 0; delete this test and the ' +
    'note in reflex.mjs that says it does not')
})

// ============================================================================
// C. THE CHAIN. Not the guard -- the composition, on the measured terrain.
// ============================================================================

await t('POSITIVE CONTROL: the trap reproduces — harvestAdjacent tries every ' +
        'neighbour and digs none', async () => {
  const bot = makeBot(POCKET(), { inv: [] })
  const got = await harvestAdjacent(bot, 4, 8000)
  assert.ok(got.tried >= 6,
    `the fixture must reach the canHarvest refusal, not fall short of it (tried=${got.tried})`)
  assert.strictEqual(got.dug, 0, 'bare-handed stone must yield nothing')
  assert.strictEqual(got.gained, 0)
  assert.strictEqual(bot.digs.length, 0, 'and no swing should have been paid for')
})

await t('THE CHAIN: from that exact state the bot now has a legal move, and takes it', async () => {
  const bot = makeBot(POCKET(), { inv: [] })
  const before = await harvestAdjacent(bot, 4, 8000)
  assert.strictEqual(before.dug, 0, 'precondition: the old remedy has already failed')
  const y0 = bot.entity.position.y

  const r = await escapeStairUp(bot, { maxSteps: 3, budgetMs: 30_000 })
  assert.strictEqual(r.steps, 3, `expected three steps, got ${r.steps} (${r.stopped})`)
  assert.strictEqual(bot.entity.position.y - y0, 3, 'each step must gain exactly one block')
  assert.ok(bot.digs.length > 0, 'and it must have actually broken stone')
})

await t('THE HANDS STAY EMPTY: a bot holding its LAST pickaxe still climbs, and still ' +
        'holds it afterwards', async () => {
  // `mayDigForEscape` refuses `digStraightUp` on one pickaxe, correctly -- that
  // guard exists because 574 escapes destroyed the tool that made every future
  // escape possible. The ramp needs no exemption from it: it never equips.
  const pick = { name: 'wooden_pickaxe', type: 101, count: 1 }
  const bot = makeBot(POCKET(), { inv: [pick], held: pick })
  const r = await escapeStairUp(bot, { maxSteps: 2, budgetMs: 30_000 })
  assert.strictEqual(r.steps, 2, r.stopped)
  assert.ok(bot.digs.length > 0, 'nothing was dug, so the claim below is vacuous')
  for (const d of bot.digs) {
    assert.strictEqual(d.held, null, `swung at ${d.name} holding ${d.held}: that spends durability`)
  }
  assert.deepStrictEqual(bot.inventory.items(), [pick], 'the pickaxe must survive the climb')
})

await t('A ROUTE, NOT A HEIGHT, IS WHAT ENDS IT', async () => {
  const bot = makeBot(POCKET(), { canPath: true })
  const r = await escapeStairUp(bot, { maxSteps: 6, budgetMs: 30_000 })
  assert.strictEqual(r.steps, 1, `expected to stop at the first restored route, got ${r.steps}`)
  assert.match(r.stopped, /route exists/, r.stopped)
})

await t('WHEN THE RAMP REFUSES, THE BOT IS LEFT EXACTLY WHERE IT WAS', async () => {
  // This is the property that makes the whole change safe to compose: a
  // capability that declines can subtract no move the bot already had, so it
  // cannot meet an existing guard and manufacture a dead end.
  const w = POCKET()
  for (const [x, z] of [[0, 1], [0, -1], [-1, 0], [1, 0]]) {
    w.set(x, 1, z, 'bedrock'); w.set(x, 2, z, 'bedrock')
  }
  const inv = [{ name: 'stick', type: 5, count: 2 }]
  const bot = makeBot(w, { inv })
  const p0 = bot.entity.position.clone()
  const r = await escapeStairUp(bot, { maxSteps: 6, budgetMs: 30_000 })
  assert.strictEqual(r.steps, 0)
  assert.deepStrictEqual(
    [bot.entity.position.x, bot.entity.position.y, bot.entity.position.z],
    [p0.x, p0.y, p0.z], 'a refusing ramp must not have moved the bot')
  assert.deepStrictEqual(bot.inventory.items(), inv, 'nor spent anything')
  assert.strictEqual(bot.digs.length, 0, 'nor broken anything')
  assert.ok(r.stopped && r.stopped.length > 4, 'and it must say WHY, not report a bare zero')
})

await t('A RAMP STOPPED PART WAY IS KEPT, NOT UNWOUND', async () => {
  // The property that distinguishes this from `pillarOut`, which must refuse to
  // start a climb it cannot finish because a half-spent pillar leaves the bot
  // higher AND empty-handed. A ramp costs nothing to abandon: what is cut stays
  // cut and walkable, and the next firing resumes from the top of it. So the
  // ramp is allowed to start what it cannot finish, and this pins that the
  // height it did win is still there when it stops.
  const w = POCKET()
  // Force the ramp east: the other three cardinals are bedrock at the cell the
  // bot would step into. Without this the chooser is free to turn, and the test
  // would be asserting against a step it never predicted.
  w.set(0, 1, 1, 'bedrock'); w.set(0, 1, -1, 'bedrock'); w.set(-1, 1, 0, 'bedrock')
  // Then close every direction from the top of step 1, at (1,+1): lava in the
  // jump clearance ahead, bedrock either side, and behind is the hole it came
  // out of, which has no tread.
  w.set(2, 4, 0, 'lava')
  w.set(1, 2, -1, 'bedrock'); w.set(1, 2, 1, 'bedrock')
  const bot = makeBot(w, {})
  const r = await escapeStairUp(bot, { maxSteps: 4, budgetMs: 30_000 })
  assert.strictEqual(r.steps, 1, `expected exactly one step to be possible (${r.stopped})`)
  assert.strictEqual(bot.entity.position.y + 15, r.steps, 'the height won must still be there')
  assert.ok(r.stopped && r.stopped.length > 4, `and it must say why: ${r.stopped}`)
})

// ============================================================================
// D. MUTANTS. Each asserts its anchor is present and unique before it counts.
// ============================================================================

const NO_TREAD = "  if (!solid(tread)) return { ok: false, reason: `no tread to stand on (${tread.name})` }"

await t('MUTANT KILLED: without the tread check the ramp walks into a hole', async () => {
  await withMutant(SCAFFOLD_PATH, NO_TREAD, '', async mod => {
    const w = POCKET()
    w.set(1, 0, 0, 'air')
    const r = mod.stairUpStep({ at: atOf(w), bear: E })
    assert.strictEqual(r.ok, true,
      'the mutant did not change the answer, so the guard was never what refused')
  })
  // and the real one still refuses -- the half that proves the mutant was the
  // cause rather than a coincidence
  const w = POCKET()
  w.set(1, 0, 0, 'air')
  assert.strictEqual(stairUpStep({ at: atOf(w), bear: E }).ok, false)
})

const LAVA_ONLY = "  isLava = b => /lava/.test(b?.name ?? ''),\n  canBreak = () => true,"
const LAVA_WIDENED = "  isLava = b => /lava|water/.test(b?.name ?? ''),\n  canBreak = () => true,"

await t('MUTANT KILLED: widening the lava check to water rebuilds the drowning-era veto', async () => {
  await withMutant(SCAFFOLD_PATH, LAVA_ONLY, LAVA_WIDENED, async mod => {
    const w = POCKET()
    w.set(1, 1, 0, 'water'); w.set(1, 2, 0, 'water')
    const r = mod.stairUpStep({ at: atOf(w), bear: E })
    assert.strictEqual(r.ok, false,
      'the mutant left water passable, so the water test above proves nothing')
  })
  const w = POCKET()
  w.set(1, 1, 0, 'water'); w.set(1, 2, 0, 'water')
  assert.strictEqual(stairUpStep({ at: atOf(w), bear: E }).ok, true,
    'and unmutated, water must still be terrain')
})

const WET_ORDERS = '    if (!best || runway > best.runway || (runway === best.runway && wet < best.wet)) {'
const WET_VETOES = '    if (wet > 0) continue\n    if (!best || runway > best.runway || (runway === best.runway && wet < best.wet)) {'

await t('MUTANT KILLED: promoting wetness from an ordering to a veto strands the bot', async () => {
  await withMutant(SCAFFOLD_PATH, WET_ORDERS, WET_VETOES, async mod => {
    const w = POCKET()
    for (const [x, z] of [[0, 1], [0, -1], [-1, 0]]) {
      w.set(x, 1, z, 'bedrock'); w.set(x, 2, z, 'bedrock')
    }
    w.set(1, 1, 0, 'water'); w.set(1, 2, 0, 'water')
    const canBreak = b => b.diggable !== false
    const c = mod.chooseStairUpBearing({ at: atOf(w), bearings: escapeBearings(0), depth: 1, canBreak })
    assert.ok(!c || c.runway === 0,
      'the veto mutant still found a bearing, so the wet-only-bearing test is not load bearing')
  })
})

const DIG_ORDER =
  "  for (const [cell, dy, what] of [[clearance, 3, 'jump clearance'], [head, 2, 'headroom'], [feet, 1, 'step']]) {"
const DIG_ORDER_SWAPPED =
  "  for (const [cell, dy, what] of [[feet, 1, 'step'], [head, 2, 'headroom'], [clearance, 3, 'jump clearance']]) {"

await t('MUTANT KILLED: digging bottom-up pours a gravel column into the step', async () => {
  await withMutant(SCAFFOLD_PATH, DIG_ORDER, DIG_ORDER_SWAPPED, async mod => {
    const r = mod.stairUpStep({ at: atOf(POCKET()), bear: E })
    assert.deepStrictEqual(r.dig, [[1, 1, 0], [1, 2, 0], [1, 3, 0]],
      'the mutant did not reorder anything, so the ordering assertion is decorative')
  })
})

const THIRD_CELL = '  const clearance = at(bx, 3, bz)'
const THIRD_CELL_GONE = "  const clearance = { name: 'air', boundingBox: 'empty' }"

await t('MUTANT KILLED: dropping the jump-clearance cell stalls the ramp after one step', async () => {
  // The bug the first version of this file actually shipped with, kept as a
  // mutant so it cannot come back quietly. A single-step test is blind to it.
  await withMutant(SCAFFOLD_PATH, THIRD_CELL, THIRD_CELL_GONE, async mod => {
    const canBreak = b => b.diggable !== false
    assert.strictEqual(mod.stairUpRunway({ at: atOf(POCKET()), bear: E, depth: 4, canBreak }), 1,
      'the mutant still ran the full depth, so the runway test is not what proves the third cell')
    assert.ok(mod.stairUpStep({ at: atOf(POCKET()), bear: E, canBreak }).ok,
      'and the FIRST step still looks fine, which is exactly why this needed a runway')
  })
})

// ANCHORED ON THE STEP LOOP'S unequip SPECIFICALLY. The same line now appears
// three times -- the ceiling breach and `unburySelf` empty the hand too -- so a
// bare match is ambiguous and `withMutant` rightly refuses it. The preceding
// comment line is what makes this one unique, and the EXECUTABLE line is what
// the mutant deletes.
const UNEQUIP = `    // server round trip and the durability that matters is spent on the dig.
    if (bot.heldItem) await bot.unequip('hand').catch(() => {})`
const UNEQUIP_GONE = '    // server round trip and the durability that matters is spent on the dig.'

await t('MUTANT KILLED: without the unequip the climb swings the last pickaxe', async () => {
  await withMutant(REFLEX_PATH, UNEQUIP, UNEQUIP_GONE, async mod => {
    const pick = { name: 'wooden_pickaxe', type: 101, count: 1 }
    const bot = makeBot(POCKET(), { inv: [pick], held: pick })
    await mod.escapeStairUp(bot, { maxSteps: 2, budgetMs: 30_000 })
    assert.ok(bot.digs.length > 0, 'the mutant dug nothing, so it proved nothing')
    assert.ok(bot.digs.some(d => d.held === 'wooden_pickaxe'),
      'the mutant still emptied the hand somewhere, so the unequip line is not what does it')
  })
})

// ============================================================================
// E. THE WIRING. A capability nothing calls is not shipped.
// ============================================================================

/**
 * A SOURCE ASSERTION, AND WHY THIS ONE IS LEGITIMATE.
 *
 * Behaviour cannot reach here. The call site is inside `startReflexes`'s 500ms
 * interval, behind `runner.isBusy()`, a 60s check throttle, a 120s prerequisite
 * cooldown and a live `canStartAPath` search; driving it would mean standing up
 * the whole reflex loop, and a test that elaborate tends to prove itself rather
 * than the code. "Is the new capability wired into the branch that used to be
 * the dead end" is exactly the structural invariant CLAUDE.md keeps source
 * assertions for.
 *
 * So it is written the way that file demands: comments stripped first (they
 * quote the code they explain, and a naive grep matches the explanation),
 * anchored on the executable line, ORDER-SENSITIVE rather than mere presence --
 * the ramp must be tried BEFORE the prerequisite that has expired 453 times --
 * and proved to fail for the intended reason by a mutant.
 */
const REFLEX_CODE = readFileSync(REFLEX_PATH, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter(l => !l.trim().startsWith('//')).join('\n')

// ANCHORED ON THE MAROON CALL SITE, NOT ON THE CAPABILITY.
//
// This read `indexOf('await escapeStairUp(bot)')` while the ramp had exactly one
// caller, and the day the entombment handler became the second one the mutant
// below went green with the call it deletes still in the file: removing one of
// two call sites leaves the substring behind. A bare `escapeStairUp` is now a
// question about the wrong thing. `const ramp =` names THIS branch's call and
// `const stair =` names the entombed one, so each site is asserted where it
// belongs and neither can stand in for the other.
const MAROON_CALL_EXPR = 'const ramp = await escapeStairUp(bot, {'

await t('WIRED: the ramp is tried before the scaffold prerequisite, not after it', () => {
  const call = REFLEX_CODE.indexOf(MAROON_CALL_EXPR)
  const ask = REFLEX_CODE.indexOf('bot.pendingPrereq = scaffoldPrereq(')
  assert.ok(call > 0, 'escapeStairUp is never called from the reflex: the capability is not shipped')
  assert.ok(ask > 0, 'the scaffold prerequisite is gone; this assertion no longer anchors on anything')
  assert.ok(call < ask,
    'the ramp must be attempted BEFORE handing the problem to a layer that ' +
    'cannot travel to solve it')
})

const RAMP_CALL = '            const ramp = await escapeStairUp(bot, {'

await t('MUTANT KILLED: unwiring the call is caught, and caught for the right reason', async () => {
  const src = readFileSync(REFLEX_PATH, 'utf8')
  assert.ok(src.includes(RAMP_CALL), 'ANCHOR MISSING')
  assert.strictEqual(src.split(RAMP_CALL).length, 2, 'the anchor is not unique; the mutant is ambiguous')
  const mutated = src.replace(RAMP_CALL, '            const ramp = ({ steps: 0, climbed: 0, stopped: "x" }) || (async () => { const q = {')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
  assert.strictEqual(mutated.includes(MAROON_CALL_EXPR), false,
    'the mutant left the call in place, so the assertion above is not what detects it')
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
