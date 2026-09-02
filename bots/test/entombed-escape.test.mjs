/**
 * THE ENTOMBED BOT AND THE RAMP DISAGREE ABOUT ONE CELL.
 *
 * `escape-stair.test.mjs` proves a bare-handed ramp is a legal move for a
 * MAROONED bot -- one whose column above is open. This file is about the other
 * half of the fleet's stuck population, and about the fact that wiring the same
 * ramp into the entombment handler unchanged would have shipped a no-op.
 *
 * `stairUpStep` refuses unless the bot's own `at(0,2,0)` is passable, which is
 * right: without it a bot cuts a perfect step and head-butts its own ceiling.
 * `isEntombed` is DEFINED by that cell being solid -- it is the first thing it
 * tests. The two are exact complements, so for every entombed bot in every
 * world all four cardinals refuse `no headroom to climb` and the runway is
 * zero. That is the fifth instance of the bug class already written down in
 * CLAUDE.md: two individually-correct guards meeting where the bot has no legal
 * move, each passing its own unit tests.
 *
 * MEASURED, NOT REASONED ABOUT. 8h window, 80 bots, positive control 372,427
 * events over 85 event kinds; 2,309 entombed events across 55 bots. Four bots
 * spent the entire window pinned to one coordinate to 0.1 blocks, with
 * 682-1,609 `_path_noPath` from that same cell, and 621-second stretches with
 * no reflex interrupt at all in which they moved 0.2 blocks. Their inventories
 * hold 5, 10, 12 and 20 placeable blocks and not one pickaxe between them,
 * against a `pillarOut` that demands 26 before it will do anything -- 24 is
 * `PILLAR_MAX_BLOCKS`, a constant, not a measurement of anyone's ceiling.
 *
 * So the trap is materials, the remedy that needs no materials is a ramp, and
 * the ramp needs exactly one cell of ceiling out of the way first.
 *
 * WHAT THIS FILE GUARDS:
 *   1. THE CHAIN, not the guard. The entombed state is built, `isEntombedForTest`
 *      is made to agree it is entombed, the ramp is shown refusing it, and only
 *      then is the fix asked for a move FROM THAT STATE.
 *   2. THE REFUSING CASE. When the ceiling cannot be broken the bot must be
 *      left in exactly the state it was in before -- same cell, same inventory.
 *      A rescue that can subtract a move the bot already had is how this
 *      codebase manufactures dead ends.
 *   3. WATER IS NOT LAVA. The new refusal reads the faces of a cell the bot is
 *      about to open, and a wet predicate widened once already multiplied
 *      drownings sevenfold. Water overhead must not close it; lava must.
 *   4. THE STREAK IS A PLACE. 21.0% of entombed firings at y=60-79 came from
 *      bots in motion on both sides of the event, so a lifetime refusal counter
 *      would buy a digging rescue in open terrain. Four refusals in four
 *      counties are not four refusals in one hole.
 */
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { writeFileSync, unlinkSync } from 'node:fs'
import { headroomBreach, chooseStairUpBearing, stairUpStep,
         bodyPassable } from '../src/scaffold.mjs'
import { escapeStairUp, refusalStreak, refusalEscalation, rampStatus,
         maroonState, isEntombedForTest, notAWallForTest } from '../src/reflex.mjs'

let pass = 0, fail = 0
const t = (name, fn) => Promise.resolve()
  .then(fn)
  .then(() => { pass++; console.log(`  PASS  ${name}`) })
  .catch(e => { fail++; console.log(`  FAIL  ${name}\n        ${e.message}`) })

const SCAFFOLD_PATH = new URL('../src/scaffold.mjs', import.meta.url)
const REFLEX_PATH = new URL('../src/reflex.mjs', import.meta.url)

/** Verbatim from climb-escape.test.mjs. Writes a sibling module, never src/. */
async function withMutant (path, old, neu, fn) {
  const src = readFileSync(path, 'utf8')
  assert.ok(src.includes(old),
    `MUTATION DID NOT APPLY: ${JSON.stringify(old.slice(0, 60))} is not in ${path.pathname}. ` +
    'A mutant that was never written reads as killed.')
  assert.ok(src.split(old).length === 2, 'the mutation target is not unique; the mutant is ambiguous')
  const body = src.replace(old, neu).replace(/from '\.\//g, "from '../src/")
  const out = new URL(`./_mutant-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`, import.meta.url)
  writeFileSync(out, body)
  try { return await fn(await import(out.href)) } finally { try { unlinkSync(out) } catch {} }
}

// --- the world --------------------------------------------------------------
// Same conventions as escape-stair.test.mjs: relative to the bot's feet, and
// liquids get an EMPTY boundingBox because that is what the real registry says.

const DIG_MS = {
  stone: 7500, granite: 7500, deepslate: 15_000, cobbled_deepslate: 17_500,
  dirt: 750, grass_block: 900, gravel: 3000, obsidian: 250_000,
}

function blk (name, pos) {
  if (name === 'air' || !name) return { name: 'air', boundingBox: 'empty', position: pos }
  if (name === 'water' || name === 'lava') return { name, boundingBox: 'empty', position: pos }
  if (name === 'bedrock') {
    return { name, boundingBox: 'block', position: pos, diggable: false, digTime: () => null }
  }
  return {
    name, boundingBox: 'block', position: pos, diggable: true,
    digTime: () => DIG_MS[name] ?? 7500,
    canHarvest: () => true,
  }
}

const V = (x, y, z) => ({
  x, y, z,
  offset: (a, b, c) => V(x + a, y + b, z + c),
  clone: () => V(x, y, z),
})

function world (cells = {}, { fill = 'stone' } = {}) {
  const m = new Map(Object.entries(cells))
  return {
    get (x, y, z) { const k = `${x},${y},${z}`; return m.has(k) ? m.get(k) : fill },
    set (x, y, z, name) { m.set(`${x},${y},${z}`, name) },
  }
}

const atOf = w => (dx, dy, dz) => blk(w.get(dx, dy, dz), V(dx, dy, dz))

/**
 * A SEALED POCKET: feet and head air, everything else stone, in a hill.
 *
 * This is the terrain `isEntombed` is looking for -- solid ceiling at +2, four
 * solid walls at +1 -- and it is deliberately built to satisfy that predicate
 * rather than to look like it does. The assertion below is what makes it a
 * fixture for THIS trap and not a hole that merely resembles one.
 */
const TOMB = () => world({ '0,0,0': 'air', '0,1,0': 'air' })

const N = { x: 0, z: -1 }, S = { x: 0, z: 1 }, E = { x: 1, z: 0 }, W = { x: -1, z: 0 }
const CARDINALS = [S, W, N, E]

function makeBot (w, { y = 44, inv = [], held = null, canPath = false } = {}) {
  const digs = []
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
      // Inverts the `atan2(-x, -z)` the code actually turns the bot with, so a
      // correct step moves and an incorrect one reads as "cut a step but could
      // not stand in it" rather than passing by accident.
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
// A. THE TRAP REPRODUCES. Without this every test below could be about a hole
//    that no bot is ever in.
// ============================================================================

await t('POSITIVE CONTROL: the fixture is a tomb by the predicate\'s own reckoning', () => {
  const w = TOMB()
  const bot = makeBot(w)
  assert.strictEqual(isEntombedForTest(bot), true,
    'the fixture does not satisfy isEntombed, so nothing below is about entombed bots')
  // And the control for the control: open the ceiling and it stops being one,
  // so the predicate is reading the cell this file claims it reads.
  const open = TOMB(); open.set(0, 2, 0, 'air')
  assert.strictEqual(isEntombedForTest(makeBot(open)), false,
    'isEntombed did not change when the ceiling did; the fixture proves nothing')
})

await t('THE DEADLOCK: every cardinal refuses an entombed bot for the SAME one cell', () => {
  const at = atOf(TOMB())
  const choice = chooseStairUpBearing({ at, bearings: CARDINALS, depth: 4 })
  assert.strictEqual(choice.runway, 0,
    'the ramp found a runway in a sealed pocket; the deadlock this file fixes is not real')
  for (const bear of CARDINALS) {
    const r = stairUpStep({ at, bear })
    assert.strictEqual(r.ok, false)
    assert.match(r.reason, /no headroom to climb/,
      `expected the headroom refusal, got: ${r.reason} — if the ramp now refuses ` +
      'for a different reason, the fix in this file is aimed at the wrong cell')
  }
})

await t('ONE CELL IS THE WHOLE DISTANCE: breaching takes runway 0 to 4', () => {
  const w = TOMB()
  const plan = headroomBreach({ at: atOf(w), canBreak: () => true })
  assert.ok(plan.ok, plan.reason)
  assert.deepStrictEqual(plan.dig, [[0, 2, 0]], 'exactly the cell isEntombed is defined by')
  for (const [dx, dy, dz] of plan.dig) w.set(dx, dy, dz, 'air')
  assert.strictEqual(
    chooseStairUpBearing({ at: atOf(w), bearings: CARDINALS, depth: 4 }).runway, 4,
    'with the ceiling out of the way the ramp must run')
})

// ============================================================================
// B. headroomBreach, BY BEHAVIOUR.
// ============================================================================

await t('an already-open ceiling is a plan to do NOTHING, never a refusal', () => {
  const w = TOMB(); w.set(0, 2, 0, 'air')
  const r = headroomBreach({ at: atOf(w) })
  assert.strictEqual(r.ok, true,
    'a marooned bot has an open column by definition; refusing here would ' +
    'un-ship the ramp for every caller it already had')
  assert.deepStrictEqual(r.dig, [], 'there is nothing to break, so nothing may be dug')
})

await t('unloaded terrain overhead is refused, not read as open sky', () => {
  const r = headroomBreach({ at: () => null })
  assert.strictEqual(r.ok, false)
  assert.match(r.reason, /not loaded/)
})

await t('bedrock overhead is refused by the registry\'s numbers, not by a name list', () => {
  const w = TOMB(); w.set(0, 2, 0, 'bedrock')
  const r = headroomBreach({ at: atOf(w), canBreak: b => b?.diggable !== false })
  assert.strictEqual(r.ok, false)
  assert.match(r.reason, /cannot clear bedrock overhead/)
})

await t('a LAVA ceiling is a REFUSAL, because the first move is a jump through it', () => {
  // THIS ASSERTION USED TO SAY THE OPPOSITE, and the reasoning that got it
  // there is worth keeping: lava reports an EMPTY boundingBox, so a
  // bounding-box test calls a lava ceiling "already open", so a refusal here
  // "guards a case that cannot occur". True of the arithmetic and false of the
  // bot. `stairUpStep` requires (0,2,0) passable and then JUMPS the bot through
  // it -- that is the cell the head passes through on the way to the new step.
  // `bodyPassable` is the fix: a body may not occupy lava whatever the registry
  // says its box is, so the cell reads as closed and is named rather than
  // silently climbed into. Fire is 12% of fleet deaths.
  const w = TOMB(); w.set(0, 2, 0, 'lava')
  const r = headroomBreach({ at: atOf(w) })
  assert.strictEqual(r.ok, false, 'the ramp would jump the bot up through lava')
  assert.match(r.reason, /lava overhead/)
  assert.strictEqual(r.dig, undefined, 'a liquid ceiling must never be dug at')
})

await t('POSITIVE CONTROL: water in the same cell is still open, so this is not a wet veto', () => {
  const w = TOMB(); w.set(0, 2, 0, 'water')
  const r = headroomBreach({ at: atOf(w) })
  assert.strictEqual(r.ok, true, `water closed the ceiling: ${r.reason}`)
  assert.deepStrictEqual(r.dig, [], 'water is terrain; there is nothing there to break')
})

await t('LAVA BESIDE THE CEILING CLOSES IT TOO: the faces are checked, not just the cell', () => {
  const w = TOMB(); w.set(0, 3, 0, 'lava')
  assert.match(headroomBreach({ at: atOf(w) }).reason, /lava against the ceiling/)
})

await t('WATER OVERHEAD DOES NOT CLOSE IT: water is terrain, and swimming is travel', () => {
  // The standing owner directive, and the regression that earned it: widening a
  // wet predicate multiplied drownings sevenfold on 2026-08-29. A bot under a
  // pond must still be allowed out from under it.
  const w = TOMB(); w.set(0, 3, 0, 'water')
  const r = headroomBreach({ at: atOf(w) })
  assert.strictEqual(r.ok, true, `water was treated as a hazard: ${r.reason}`)
  assert.deepStrictEqual(r.dig, [[0, 2, 0]])
})

// ============================================================================
// C. THE CHAIN. From the state the fleet is actually in.
// ============================================================================

await t('THE CHAIN: an entombed bot breaches its ceiling and climbs out of the tomb', async () => {
  const w = TOMB()
  const bot = makeBot(w, { y: 44 })
  assert.strictEqual(isEntombedForTest(bot), true)
  const before = bot.entity.position.y

  const r = await escapeStairUp(bot, { maxSteps: 4, budgetMs: 20_000 })

  assert.strictEqual(r.breached, 1, `the ceiling was not taken: stopped=${r.stopped}`)
  assert.ok(r.steps > 0, `no step was cut from a state the ramp used to refuse: ${r.stopped}`)
  assert.ok(bot.entity.position.y > before,
    'the bot reported steps without gaining height, which is the "cut a ledge and ' +
    'called it a climb" failure mine paid for over twenty-three days')
  assert.strictEqual(isEntombedForTest(bot), false, 'still entombed after the climb')
})

await t('NOTHING IS SPENT: the climb places no block and swings no tool', async () => {
  const pick = { name: 'wooden_pickaxe', count: 1, type: 101 }
  const bot = makeBot(TOMB(), { y: 44, inv: [pick], held: pick })
  bot.placeBlock = () => { throw new Error('the escape ramp placed a block') }
  const r = await escapeStairUp(bot, { maxSteps: 4, budgetMs: 20_000 })
  assert.ok(r.steps > 0, r.stopped)
  assert.deepStrictEqual(bot.inventory.items(), [pick],
    'the bot that could not afford to pillar must not have paid for the ramp either')
  assert.deepStrictEqual([...new Set(bot.digs.map(d => d.held))], [null],
    `the ceiling or a step was dug with a tool in hand: ${JSON.stringify(bot.digs)}`)
})

await t('WHEN THE CEILING REFUSES, THE BOT IS LEFT EXACTLY WHERE IT WAS', async () => {
  // The composition property. A remedy that can subtract a move the bot already
  // had is worse than no remedy, and this is the case where it would.
  const w = TOMB(); w.set(0, 2, 0, 'bedrock')
  const inv = [{ name: 'dirt', count: 10, type: 9 }]
  const bot = makeBot(w, { y: 44, inv })
  const at0 = bot.entity.position

  const r = await escapeStairUp(bot, { maxSteps: 4, budgetMs: 20_000 })

  assert.strictEqual(r.steps, 0)
  assert.strictEqual(r.breached, 0)
  assert.match(r.stopped, /cannot clear bedrock overhead/,
    'the refusal must name the cell that refused, or "sealed under bedrock" and ' +
    '"no tread to stand on" arrive as the same zero')
  assert.deepStrictEqual(
    [bot.entity.position.x, bot.entity.position.y, bot.entity.position.z],
    [at0.x, at0.y, at0.z], 'the bot moved during a refusal')
  assert.deepStrictEqual(bot.inventory.items(), inv, 'the refusal cost the bot inventory')
  assert.deepStrictEqual(bot.digs, [], 'a refusal must not have dug anything')
})

await t('A ROUTE ENDS IT: the ramp stops as soon as a journey can start again', async () => {
  const bot = makeBot(TOMB(), { y: 44, canPath: true })
  const r = await escapeStairUp(bot, { maxSteps: 6, budgetMs: 20_000 })
  assert.strictEqual(r.stopped, 'a route exists again',
    `the condition the trap denies is a route, not a height: ${r.stopped}`)
  assert.ok(r.steps <= 2, `kept digging after the trap was over: ${r.steps} steps`)
})

// ============================================================================
// D. refusalStreak: the escalation is scoped to ONE hole.
// ============================================================================

await t('refusals in the same cell accumulate', () => {
  const p = { x: 10, y: 44, z: 20 }
  let s = refusalStreak(0, null, p)
  assert.strictEqual(s, 1, 'the first refusal anywhere starts a streak of one')
  s = refusalStreak(s, p, { x: 10, y: 44, z: 20 })
  s = refusalStreak(s, p, { x: 10.2, y: 44, z: 20.1 })
  assert.strictEqual(s, 3, 'a bot drifting a fraction of a block is in the same hole')
})

await t('a refusal somewhere else STARTS AGAIN: four counties are not four tries', () => {
  // 21.0% of entombed firings at y=60-79 (n=252, positive control 14 of 14
  // sampled bots seen travelling >50 blocks) came from bots in motion on both
  // sides of the event. A lifetime counter turns four of those into the
  // threshold that buys a digging rescue in open terrain.
  const s = refusalStreak(3, { x: 10, y: 44, z: 20 }, { x: 900, y: 61, z: 40 })
  assert.strictEqual(s, 1)
})

await t('HEIGHT COUNTS: a bot that climbed eight blocks is in a new hole', () => {
  assert.strictEqual(refusalStreak(3, { x: 10, y: 44, z: 20 }, { x: 10, y: 52, z: 20 }), 1,
    'escalating a backoff against a rescue that is working is how pillarOut ' +
    'spent ninety minutes reporting progress one block at a time')
})

// ============================================================================
// E. WIRING. Behaviour cannot reach "is this called, and in what order".
// ============================================================================

const REFLEX_CODE = readFileSync(REFLEX_PATH, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter(l => !l.trim().startsWith('//')).join('\n')

// `const stair =` names the ENTOMBED call site. A bare `escapeStairUp` would
// also match the maroon one, and an assertion that two call sites can satisfy
// is an assertion neither of them has to.
const ENTOMBED_CALL_EXPR = 'const stair = esc.ramp ? await escapeStairUp(bot, {'

await t('WIRED: the entombed handler cuts a ramp BEFORE asking for 26 blocks', () => {
  const call = REFLEX_CODE.indexOf(ENTOMBED_CALL_EXPR)
  const ask = REFLEX_CODE.indexOf('climbPrereqFor(climbed)')
  assert.ok(call > 0, 'the entombment handler never calls the ramp: it is not shipped there')
  assert.ok(ask > 0, 'climbPrereqFor is gone; this assertion no longer anchors on anything')
  assert.ok(call < ask,
    'the ramp must be attempted BEFORE the prerequisite -- 453 of 479 of those ' +
    'expired at the TTL reading `had 0/8`, asked of bots that cannot travel')
})

// ============================================================================
// F. MUTANTS. Each asserts its anchor is present AND unique before it applies.
// ============================================================================

const BREACH_BLOCK = `    const plan = headroomBreach({ at, canBreak })
    if (!plan.ok) {`
const BREACH_SKIPPED = `    const plan = { ok: true, dig: [] }
    if (!plan.ok) {`

await t('MUTANT KILLED: without the ceiling breach the ramp is a no-op for every tomb', async () => {
  await withMutant(REFLEX_PATH, BREACH_BLOCK, BREACH_SKIPPED, async mod => {
    const bot = makeBot(TOMB(), { y: 44 })
    const r = await mod.escapeStairUp(bot, { maxSteps: 4, budgetMs: 20_000 })
    assert.strictEqual(r.steps, 0,
      'the mutant still climbed, so the breach is not what makes the chain work')
    assert.match(r.stopped, /no headroom to climb/,
      `expected the old deadlock back, got: ${r.stopped}`)
  })
})

const ALREADY_OPEN = '    return { ok: true, dig: [] }\n  }\n'
const ALREADY_OPEN_REFUSES = "    return { ok: false, reason: 'headroom already open' }\n  }\n"

await t('MUTANT KILLED: folding "nothing to break" into a refusal un-ships the maroon ramp', async () => {
  // The mutant must produce the BROKEN answer. If it produced the right one,
  // the assertion in section B is passing for some other reason than the tri-
  // state it claims to be about.
  await withMutant(SCAFFOLD_PATH, ALREADY_OPEN, ALREADY_OPEN_REFUSES, async mod => {
    const w = TOMB(); w.set(0, 2, 0, 'air')
    const r = mod.headroomBreach({ at: atOf(w) })
    assert.strictEqual(r.ok, false,
      'the mutant did not change the answer, so section B does not test this line')
    assert.match(r.reason, /already open/)
  })
})

// The parameter ORDER is what makes this anchor unique: `stairUpStep` takes the
// same two defaults the other way round, and escape-stair.test.mjs mutates its
// pair for the same reason. `withMutant` refuses an ambiguous target, so the two
// signatures must not be the same shape.
const LAVA_NARROW = "  canBreak = () => true,\n  isLava = b => /lava/.test(b?.name ?? ''),"
const LAVA_WIDENED = "  canBreak = () => true,\n  isLava = b => /lava|water/.test(b?.name ?? ''),"

await t('MUTANT KILLED: treating water as a hazard rebuilds the drowning-era veto', async () => {
  await withMutant(SCAFFOLD_PATH, LAVA_NARROW, LAVA_WIDENED, async mod => {
    const w = TOMB(); w.set(0, 3, 0, 'water')
    const r = mod.headroomBreach({ at: atOf(w) })
    assert.strictEqual(r.ok, false,
      'the mutant did not close the ceiling, so the water test above is not ' +
      'what stands between this fleet and a re-widened wet predicate')
    assert.match(r.reason, /water/)
  })
})

const FACES_CHECK = "    if (isLava(n)) return { ok: false, reason: `lava against the ceiling (${n.name})` }"
const FACES_GONE = '    if (false && isLava(n)) return { ok: false, reason: `unreachable (${n.name})` }'

await t('MUTANT KILLED: dropping the face check opens a cell with lava resting on it', async () => {
  await withMutant(SCAFFOLD_PATH, FACES_CHECK, FACES_GONE, async mod => {
    const w = TOMB(); w.set(0, 3, 0, 'lava')
    const r = mod.headroomBreach({ at: atOf(w) })
    assert.strictEqual(r.ok, true,
      'the mutant still refused, so the lava-above test is passing on some ' +
      'other line and the face check has never been seen to be what stops it')
    assert.deepStrictEqual(r.dig, [[0, 2, 0]],
      'the mutant would break the ceiling holding the lava up')
  })
})

const STREAK_SCOPED = '  if (Math.sqrt(dx * dx + dy * dy + dz * dz) > tol) return 1'
const STREAK_LIFETIME = '  if (false) return 1'

await t('MUTANT KILLED: an unscoped streak buys a digging rescue in open terrain', async () => {
  await withMutant(REFLEX_PATH, STREAK_SCOPED, STREAK_LIFETIME, async mod => {
    assert.strictEqual(mod.refusalStreak(3, { x: 10, y: 44, z: 20 }, { x: 900, y: 61, z: 40 }), 4,
      'the mutant still restarted the streak, so the distance test above is ' +
      'not what makes the escalation local to one hole')
  })
})

await t('MUTANT KILLED: unwiring the entombed call is caught, for the right reason', () => {
  const src = readFileSync(REFLEX_PATH, 'utf8')
  assert.ok(src.includes(ENTOMBED_CALL_EXPR), 'ANCHOR MISSING')
  assert.strictEqual(src.split(ENTOMBED_CALL_EXPR).length, 2,
    'the anchor is not unique; the mutant is ambiguous')
  const mutated = src.replace(ENTOMBED_CALL_EXPR, 'const stair = ({ steps: 0, stopped: "x" }) || (async () => { const q = {')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
  assert.strictEqual(mutated.includes(ENTOMBED_CALL_EXPR), false,
    'the mutant left the entombed call in place, so the WIRED assertion is not what detects it')
  // ...and the maroon call must SURVIVE it, or the assertion above is passing
  // because both call sites vanished together.
  assert.ok(mutated.includes('const ramp = await escapeStairUp(bot, {'),
    'the mutant removed the maroon call too; it is not specific to this branch')
})


// ============================================================================
// G. THE ESCALATION. Two counters, because they answer two questions.
// ============================================================================

await t('POSITIVE CONTROL: a bot pinned to one hole gets the ramp on the 4th refusal', () => {
  let refusals = 0, streak = 0, prev = null
  const here = { x: 10, y: 44, z: 20 }
  const seen = []
  for (let i = 0; i < 8; i++) {
    refusals++
    streak = refusalStreak(streak, prev, here)
    prev = here
    seen.push(refusalEscalation({ refusals, streak }))
  }
  assert.deepStrictEqual(seen.map(s => s.due), [false, false, false, true, false, false, false, true])
  assert.deepStrictEqual(seen.map(s => s.ramp), [false, false, false, true, false, false, false, true])
})

await t('A BOT THAT MOVES STILL GETS ITS BACKOFF -- the defect this replaces', () => {
  // The reviewed patch folded both uses into the scoped streak. For a bot in
  // motion the streak is 1 every time, so `% 4 === 0` was never true, so the
  // prerequisite, the telemetry AND `lastEscapeAt` were all unreachable -- while
  // the branch still fired every 15s and still called `runner.interrupt`. 21.0%
  // of entombed firings at y=60-79 come from bots in motion on both sides of
  // the event, so that is one in five bots interrupted every fifteen seconds
  // forever, with no record of it.
  let refusals = 0, streak = 0, prev = null
  let dueCount = 0, rampCount = 0
  for (let i = 0; i < 12; i++) {
    const now = { x: 100 * i, y: 62, z: 40 }        // somewhere else every time
    refusals++
    streak = refusalStreak(streak, prev, now)
    prev = now
    const esc = refusalEscalation({ refusals, streak })
    if (esc.due) dueCount++
    if (esc.ramp) rampCount++
  }
  assert.strictEqual(streak, 1, 'the streak must not accumulate across counties')
  assert.strictEqual(dueCount, 3,
    'a moving bot got no escalation at all: no prerequisite, no telemetry, no backoff')
  assert.strictEqual(rampCount, 0,
    'a bot that is not pinned to one hole must not buy a bare-handed excavation')
})

await t('THE BACKOFF ESCALATES AND IS CAPPED', () => {
  assert.strictEqual(refusalEscalation({ refusals: 4, streak: 4 }).backoffMs, 60_000)
  assert.strictEqual(refusalEscalation({ refusals: 8, streak: 8 }).backoffMs, 120_000)
  assert.strictEqual(refusalEscalation({ refusals: 400, streak: 400 }).backoffMs, 10 * 60_000,
    'an uncapped backoff is a bot that never checks again')
})

await t('MUTANT KILLED: one counter for both uses deletes the backoff for movers', async () => {
  // The reviewed shape, restored: `ramp` becomes the whole decision, so a bot
  // that moves never reaches `due` either.
  const TWO_USES = '  const due = refusals > 0 && refusals % every === 0'
  const ONE_USE = '  const due = streak > 0 && streak % every === 0'
  await withMutant(REFLEX_PATH, TWO_USES, ONE_USE, async mod => {
    let refusals = 0, dueCount = 0
    for (let i = 0; i < 12; i++) {
      refusals++
      dueCount += mod.refusalEscalation({ refusals, streak: 1 }).due ? 1 : 0
    }
    assert.strictEqual(dueCount, 0,
      'the mutant still escalated for a moving bot, so the split above is not ' +
      'what makes the backoff reachable')
  })
})

// ============================================================================
// H. THE TELEMETRY HAS A DENOMINATOR.
// ============================================================================

await t('a refused ramp is a LOGGED attempt, not an absence', () => {
  assert.strictEqual(rampStatus({ steps: 0, stopped: 'no tread to stand on' }), 'failed')
  assert.strictEqual(rampStatus({ steps: 3 }), 'success')
  assert.strictEqual(rampStatus(null), 'failed',
    'a firing that declined to cut is still a firing and must not vanish')
})

await t('WIRED: both ramp_cut sites take their status from rampStatus, not a literal', () => {
  // A STRUCTURAL INVARIANT, which is what source assertions are for here:
  // "which function decides the status" is not reachable by behaviour, because
  // the call sites are inside a 500ms interval behind four throttles. The
  // DECISION itself is tested by behaviour above; this only pins that it is the
  // one being used. Comments stripped first -- they quote the code they
  // explain -- and anchored on the executable line.
  for (const kind of ['marooned_ramp_cut', 'entombed_ramp_cut']) {
    const i = REFLEX_CODE.indexOf(`kind: '${kind}'`)
    assert.ok(i > 0, `${kind} is not emitted at all`)
    assert.strictEqual(REFLEX_CODE.split(`kind: '${kind}'`).length, 2,
      `${kind} is emitted from two places; success and failure have split apart again`)
    const near = REFLEX_CODE.slice(i, i + 200)
    assert.match(near, /status: rampStatus\(/,
      `${kind} hardcodes its status, so its success rate is 100% by construction`)
  }
})

await t('MUTANT KILLED: a hardcoded status slips past that assertion', () => {
  // A SOURCE ASSERTION THAT HAS NEVER BEEN SEEN TO FAIL IS NOT A TEST. This is
  // the regression it is supposed to catch: the status literal that made the
  // ramp's success rate 100% by construction.
  const src = readFileSync(REFLEX_PATH, 'utf8')
  const ANCHOR = 'status: rampStatus(stair),'
  assert.ok(src.includes(ANCHOR), 'ANCHOR MISSING')
  assert.strictEqual(src.split(ANCHOR).length, 2, 'the anchor is not unique; the mutant is ambiguous')
  const mutated = src.replace(ANCHOR, "status: 'success',")
    .replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
  const i = mutated.indexOf("kind: 'entombed_ramp_cut'")
  assert.ok(i > 0, 'the mutant removed the event entirely; it is not specific')
  assert.strictEqual(/status: rampStatus\(/.test(mutated.slice(i, i + 200)), false,
    'the mutant left rampStatus wired, so the assertion above is not what detects it')
  // ...and the maroon site must SURVIVE it, or the assertion passes because both vanished.
  const j = mutated.indexOf("kind: 'marooned_ramp_cut'")
  assert.match(mutated.slice(j, j + 200), /status: rampStatus\(/,
    'the mutant hit both call sites; it is not specific to the entombed one')
})

// ============================================================================
// I. THE LATCH IS PUT DOWN EVEN WHEN THE BODY THROWS.
// ============================================================================

await t('WIRED: `escaping` is cleared in a finally, and nowhere else', () => {
  // `escaping` gates both this branch and the maroon branch. A throw between
  // setting it and clearing it -- `snapshot(bot)` on a half-connected bot,
  // `logEvent` on a full disk -- lands in the tick-level catch with the flag
  // still true, and that bot never attempts another escape for the life of the
  // process. Not reachable by behaviour without standing up the whole reflex
  // loop; reachable by reading which construct clears it.
  // The declaration is not a clear. Anchored on the assignment without `let`,
  // which is the executable line, not the initialiser.
  const clears = (REFLEX_CODE.match(/(?<!let )escaping = false/g) || []).length
  assert.strictEqual(clears, 1,
    `escaping is cleared in ${clears} places; a second, unguarded path is how it sticks`)
  assert.match(REFLEX_CODE, /\} finally \{ escaping = false \}/,
    'the clear is not in a finally, so any throw above it latches the reflex off')
  const setAt = REFLEX_CODE.indexOf('escaping = true')
  const tryAt = REFLEX_CODE.indexOf('try {', setAt)
  const clearAt = REFLEX_CODE.indexOf('} finally { escaping = false }')
  assert.ok(setAt > 0 && tryAt > setAt && clearAt > tryAt,
    'the try does not open immediately after the latch is set, so there is a ' +
    'window the finally does not cover')
})

await t('MUTANT KILLED: a bare assignment instead of a finally slips past it', () => {
  const src = readFileSync(REFLEX_PATH, 'utf8')
  const ANCHOR = '        } finally { escaping = false }'
  assert.ok(src.includes(ANCHOR), 'ANCHOR MISSING')
  assert.strictEqual(src.split(ANCHOR).length, 2, 'the anchor is not unique; the mutant is ambiguous')
  const mutated = src.replace(ANCHOR, '        }\n        escaping = false')
    .replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
  assert.strictEqual(/\} finally \{ escaping = false \}/.test(mutated), false,
    'the mutant left the finally in place, so the assertion above is not what detects it')
  assert.strictEqual((mutated.match(/(?<!let )escaping = false/g) || []).length, 1,
    'the mutant changed the NUMBER of clears rather than where the one clear sits; ' +
    'it is testing the wrong property')
})

// ============================================================================
// J. ONE PASSABILITY QUESTION, ASKED TWICE ON PURPOSE.
// ============================================================================

const B = (name, boundingBox) => ({ name, boundingBox })

await t('bodyPassable is GEOMETRY, with lava and cobweb subtracted by name', () => {
  // The registry's own numbers, checked against the vendored minecraft-data:
  // lava, cobweb, vine, torch, short_grass, snow, kelp and powder_snow all
  // report `boundingBox: 'empty'`; leaves report 'block'.
  for (const n of ['air', 'cave_air', 'water', 'vine', 'torch', 'short_grass',
                   'snow', 'kelp', 'powder_snow']) {
    assert.strictEqual(bodyPassable(B(n, 'empty')), true, `${n} should be passable`)
  }
  assert.strictEqual(bodyPassable(B('lava', 'empty')), false,
    'lava reports an empty box and a body may not occupy it; this is the leak ' +
    'that let the ramp jump a bot up through a lava ceiling')
  assert.strictEqual(bodyPassable(B('cobweb', 'empty')), false,
    'a bot that enters a cobweb stops; an empty box is not a promise of travel')
  assert.strictEqual(bodyPassable(B('oak_leaves', 'block')), false,
    'leaves report a solid box, and pretending otherwise is the canopy dead end')
  assert.strictEqual(bodyPassable(null), false,
    'an unloaded chunk is not evidence of open sky')
})

await t('notAWall is DELIBERATELY WIDER, and this pins exactly how', () => {
  // Two predicates that must not drift, kept separate for reasons written down
  // beside each. This is the difference itself, asserted, so a future edit that
  // narrows one has to change this line and say why.
  const WIDER_ON = ['water', 'bubble_column', 'oak_leaves', 'birch_leaves']
  for (const n of WIDER_ON) {
    const box = n.includes('leaves') ? 'block' : 'empty'
    assert.strictEqual(notAWallForTest(B(n, box)), true,
      `${n} must not count as a wall: counting water made an ocean floor read ` +
      'as a pit, and counting leaves made every forest one')
  }
  assert.strictEqual(notAWallForTest(B('oak_leaves', 'block')), true)
  assert.strictEqual(bodyPassable(B('oak_leaves', 'block')), false,
    'the two must differ HERE and only here-ish: that is the documented gap')
  assert.strictEqual(notAWallForTest(null), true,
    'an unloaded cell is not a wall, which is the opposite of bodyPassable and ' +
    'is right for a predicate that decides whether a bot is SEALED IN')
  assert.strictEqual(notAWallForTest(B('lava', 'empty')), false,
    'lava is a wall for the purpose of being sealed in, and not passable for a ' +
    'body either: the two agree here')
})

// ============================================================================
// K. THE CANOPY DEAD END. A pre-existing trap of the same family.
// ============================================================================

const CANOPY = () => {
  // A hole with a LEAF ceiling. Everything else is exactly the tomb above.
  const w = TOMB()
  w.set(0, 2, 0, 'oak_leaves')
  return w
}

// The fixture's `blk` gives every non-liquid name a solid bounding box, which
// is what the registry says about leaves (hardness 0.2, boundingBox 'block').

await t('THE TRAP REPRODUCES: a leaf ceiling used to reach NEITHER handler', () => {
  // `upIsOpen` in the maroon branch is a bounding-box test, so leaves make it
  // FALSE. `isEntombed` used the wide `notAWall`, which CONTAINS leaves, so it
  // was FALSE too. `maroonState` returns 'none' whenever `!upIsOpen`, so the
  // bot fell through both. `_trapped_in_canopy` used to be a reflex of its own;
  // it was deleted for "zero effect" and this is where its population went.
  const leaves = { name: 'oak_leaves', boundingBox: 'block' }
  const upIsOpenOldWay = leaves.name === 'air' || leaves.boundingBox === 'empty'
  assert.strictEqual(upIsOpenOldWay, false, 'leaves must close the column, or there is no trap')
  assert.strictEqual(notAWallForTest(leaves), true,
    'and the wide predicate must call them open, or there is no disagreement')
  assert.strictEqual(
    maroonState({ upIsOpen: false, haveBlocks: false, entombed: false, canStartPath: false }),
    'none',
    'the maroon handler stands down whenever the column is closed -- so with ' +
    'isEntombed also false, nothing in this file could see the bot')
})

await t('FIXED: the same bot is now ENTOMBED, and the ramp can free it', async () => {
  const bot = makeBot(CANOPY(), { y: 44 })
  assert.strictEqual(isEntombedForTest(bot), true,
    'a bot in a hole under a leaf ceiling still reaches no handler')
  const r = await escapeStairUp(bot, { maxSteps: 4, budgetMs: 20_000 })
  assert.strictEqual(r.breached, 1, `the leaf ceiling was not taken: ${r.stopped}`)
  assert.ok(r.steps > 0, r.stopped)
  assert.ok(bot.digs.some(d => d.name === 'oak_leaves'),
    'the remedy has to be executable from where the bot is: leaves are hardness ' +
    '0.2 and come out bare-handed, which is why this is a fix and not a refusal')
  assert.strictEqual(isEntombedForTest(bot), false)
})

await t('AND THE FOREST IS NOT NOW A FLEET OF ENTOMBED BOTS', async () => {
  // The risk of narrowing the ceiling test is a reflex storm: `isEntombed` fired
  // 1,997 times in 40 minutes once before, at an average y of 64. Only the
  // CEILING moved to the narrow predicate -- the wall count and the
  // higher-ground probe keep the wide one -- so a bot standing under a tree in
  // the open still fails the wall count and nothing changes for it.
  const open = world({ '0,0,0': 'air', '0,1,0': 'air' }, { fill: 'air' })
  open.set(0, -1, 0, 'grass_block')
  open.set(0, 2, 0, 'oak_leaves')
  assert.strictEqual(isEntombedForTest(makeBot(open, { y: 44 })), false,
    'a bot standing under a tree in open ground is not entombed, and calling it ' +
    'so is how the 1,997-in-40-minutes storm happened')
})

await t('MUTANT KILLED: the wide predicate on the ceiling rebuilds the canopy dead end', async () => {
  const NARROW = '  if (bodyPassable(ceiling) || !ceiling) return false'
  const WIDE = '  if (notAWall(ceiling)) return false'
  await withMutant(REFLEX_PATH, NARROW, WIDE, async mod => {
    const bot = makeBot(CANOPY(), { y: 44 })
    assert.strictEqual(mod.isEntombedForTest(bot), false,
      'the mutant still called it entombed, so the ceiling predicate is not what ' +
      'fixes the canopy trap and the test above is passing for another reason')
  })
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
